import { exec } from "child_process";
import type { RouteHandlerMethod } from "fastify";
import { performance } from "perf_hooks";
import { getConfig } from "../config";
import { getNoteByFilename } from "../lib/get-note";
import { parseNote } from "../lib/parse-note";

const RESULT_LIMIT = 10;

export interface SearchRouteHandler {
  Querystring: {
    phrase: string;
  };
  Reply: {
    items: SearchResultItem[];
    durationInMs: number;
  };
}

export interface SearchResultItem {
  filename: string;
  title: string;
  score: number;
}

export const handleSearchRoute: RouteHandlerMethod<any, any, any, SearchRouteHandler> = async (request, reply) => {
  const config = await getConfig();

  const query = request.query;
  const phrase = query.phrase;
  const notesDir = config.notesDir;

  const now = performance.now();
  const items = await searchRipgrep(phrase, notesDir);
  const durationInMs = performance.now() - now;

  return {
    items,
    durationInMs,
  };
};

function searchRipgrep(phrase: string, dir: string): Promise<SearchResultItem[]> {
  const wordsInput = phrase.trim().split(" ").join("\\W+(?:\\w+\\W+){0,3}?"); // two words separated by 0 to 3 other words

  return new Promise((resolve, reject) => {
    /**
     * \\b ensures word boundary
     *
     * trim result with `| head` to prevent node buffer overflow
     */
    exec(
      `rg "\\b${wordsInput}" --ignore-case --count-matches | head -n ${RESULT_LIMIT}`,
      {
        cwd: dir,
      },
      async (error, stdout, stderr) => {
        if (error) {
          if (error.code === 1) {
            resolve([]);
          } else {
            reject(stderr);
          }
        } else if (!stdout.length) {
          resolve([]);
        } else {
          const lines = stdout.trim().split("\n");
          const searchResultItems = lines
            .map((line) => line.split(":") as [filename: string, count: string])
            .map((line) => ({ filename: line[0], score: parseInt(line[1]) }));

          // open each note to parse its title
          const notesAsync = searchResultItems.map(async (item) => {
            const markdown = await getNoteByFilename(item.filename);
            const parseResult = parseNote(markdown);

            return {
              filename: item.filename,
              title: parseResult.metadata.title,
              content: parseResult.content,
              score: item.score,
            };
          });

          const notes: SearchResultItem[] = await Promise.all(notesAsync);
          const sortedNotes = notes
            .sort((a, b) => a.title.localeCompare(b.title)) // sort title first to result can remain the same
            .sort((a, b) => b.score - a.score);

          resolve(sortedNotes);
        }
      }
    );
  });
}
