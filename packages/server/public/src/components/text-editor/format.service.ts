import { sanitizeHtml } from "../../utils/sanitize-html.js";
import { URL_PATTERN_WITH_PREFIX } from "../../utils/url.js";
import type { CaretService } from "./caret.service.js";
import type { LineElement, LineType } from "./helpers/source-to-lines.js";
import { removeLineEnding } from "./helpers/string.js";
import type { LineQueryService } from "./line-query.service.js";

export interface FormatContext {
  indentFromHeading: number;
  indentFromList: number;
  isLevelDirty: boolean;
}

interface FormatLineSummary {
  lengthChange: number;
  lineType: LineType;
}

export interface FormatConfig {
  syntaxOnly?: boolean;
}

export interface ParseDocumentConfig {
  includeCleanLines?: boolean;
}

export class FormatService {
  constructor(private caretService: CaretService, private lineQueryService: LineQueryService) {}

  /**
   * Format all lines with dirty syntax flag. Indent will be kept dirty.
   */
  parseLines(root: HTMLElement | DocumentFragment) {
    // TODO the context is not used. Clean up the signature of format line so we don't have to pass it in
    const context: FormatContext = {
      indentFromHeading: 0,
      indentFromList: 0,
      isLevelDirty: false,
    };

    const lines = [...root.querySelectorAll("[data-line]")] as LineElement[];

    lines.forEach((line) => {
      if (line.dataset.dirtySyntax !== undefined) {
        this.formatLine(line, context, { syntaxOnly: true });

        delete line.dataset.dirtySyntax;
      }
    });
  }

  parseDocument(root: HTMLElement | DocumentFragment, config: ParseDocumentConfig = {}) {
    const caret = this.caretService.caret;
    let caretLine: HTMLElement;
    let previousCaretOffset: number | null = null;

    if (caret) {
      caretLine = this.lineQueryService.getLine(caret.focus.node)!;
      const { offset } = this.caretService.getCaretLinePosition(caret.focus);
      previousCaretOffset = offset;
    }

    const lines = [...root.querySelectorAll("[data-line]")] as LineElement[];
    const context: FormatContext = {
      indentFromHeading: 0,
      indentFromList: 0,
      isLevelDirty: false,
    };

    lines.forEach((line) => {
      const isLineClean = line.dataset.dirtyIndent === undefined && line.dataset.dirtySyntax === undefined;

      // update context without formatting when context and line are both clean
      if (!config.includeCleanLines && !context.isLevelDirty && isLineClean) {
        this.updateContextFromLine(line, context);
        return;
      }

      // otherwise, format the line
      const { lengthChange, lineType } = this.formatLine(line, context);
      this.updateContextFromLine(line, context);

      // update line dirty state (this is independent from context)
      delete line.dataset.dirtyIndent;
      delete line.dataset.dirtySyntax;

      // update context dirty state
      if (!context.isLevelDirty && !isLineClean) {
        // when context is clean, any dirty line can pollute the levels below (e.g. fill a blank line with text can join some contexts)
        context.isLevelDirty = true;
      } else if (context.isLevelDirty && isLineClean && this.isIndentResetLineType(lineType)) {
        // when context is dirty, a clean heading line cleans context (note, a clean list line alone cannot clean context)
        context.isLevelDirty = false;
      }

      // restore caret
      if ((line as any) === caretLine) {
        const newOffset = Math.max(0, previousCaretOffset! + lengthChange);
        this.caretService.setCollapsedCaretToLineOffset({ line: caretLine, offset: newOffset });
      }
    });
  }

  getPortableText(lines: HTMLElement[], startLineOffset = 0, endLineOffset?: number): string {
    const text = lines
      .map((line, index) => {
        const metrics = this.lineQueryService.getLineMetrics(line);
        const startOffset = index === 0 ? Math.max(metrics.indent, startLineOffset) : metrics.indent;
        const endOffset = index === lines.length - 1 ? endLineOffset : undefined;

        return line.textContent!.slice(startOffset, endOffset);
      })
      .join("");

    return text;
  }

  updateContextFromLine(line: LineElement, context: FormatContext) {
    const rawText = line.textContent ?? "";

    // heading
    let match = rawText.match(/^(\s*)(#+) (.*)\n?/);
    if (match) {
      const [raw, spaces, hashes, text] = match;

      context.indentFromHeading = hashes.length * 2;
      context.indentFromList = 0; // heading resets list indent

      return;
    }

    // unordered list
    match = rawText.match(/^(\s*)(-+) (.*)\n?/);
    if (match) {
      const [raw, spaces, hypens, text] = match;

      context.indentFromList = hypens.length * 2;

      return;
    }

    // blank line
    match = rawText.match(/^(\s+)$/);
    if (match) {
      context.indentFromList = 0;
    }
  }

  formatLine(line: LineElement, context: FormatContext, config: FormatConfig = {}): FormatLineSummary {
    const rawText = sanitizeHtml(line.textContent ?? "");

    // heading
    let match = rawText.match(/^(\s*)(#+) (.*)\n?/);
    if (match) {
      const [raw, spaces, hashes, text] = match;

      line.dataset.headingLevel = hashes.length.toString();
      line.dataset.line = "heading";

      const indent = config.syntaxOnly ? spaces : ` `.repeat(hashes.length - 1);
      const hiddenHashes = `#`.repeat(hashes.length - 1);

      line.innerHTML = `<span data-indent>${indent}</span><span data-wrap><span class="t--ghost">${hiddenHashes}</span><span class="t--bold"># ${text}</span>\n</span>`;

      return {
        lengthChange: indent.length + hiddenHashes.length + 2 + text.length + 1 - raw.length,
        lineType: "heading",
      };
    }

    // unordered list
    match = rawText.match(/^(\s*)(-+) (.*)\n?/);
    if (match) {
      const [raw, spaces, hypens, text] = match;

      line.dataset.line = "list";
      line.dataset.listLevel = hypens.length.toString();
      line.dataset.listType = "unordered";

      const indent = config.syntaxOnly ? spaces : ` `.repeat(context.indentFromHeading + hypens.length - 1);
      const hiddenHyphens = `-`.repeat(hypens.length - 1);

      line.innerHTML = `<span data-indent>${indent}</span><span data-wrap><span class="t--ghost">${hiddenHyphens}</span><span class="list-marker">-</span> ${text}\n</span>`;

      return {
        lengthChange: indent.length + hiddenHyphens.length + 2 + text.length + 1 - raw.length,
        lineType: "list",
      };
    }

    // meta
    match = rawText.match(/^#\+(.+?): (.*)\n?/);
    if (match) {
      const [raw, metaKey, metaValue] = match;

      line.dataset.line = "meta";

      switch (metaKey) {
        case "url":
          line.innerHTML = `<span data-wrap><span class="t--secondary">#+${metaKey}: </span><span data-url="${metaValue}">${metaValue}</span>\n</span>`;
          break;
        case "title":
          line.innerHTML = `<span data-wrap><span class="t--secondary">#+${metaKey}: </span><span data-meta-value="title">${metaValue}</span>\n</span>`;
          break;
        case "tags":
          line.innerHTML = `<span data-wrap><span class="t--secondary">#+${metaKey}: </span><span data-meta-value="tags">${metaValue}</span>\n</span>`;
          break;
        case "created":
          line.innerHTML = `<span data-wrap><span class="t--secondary">#+${metaKey}: </span><span data-meta-value="created">${metaValue}</span>\n</span>`;
          break;
        default:
          line.innerHTML = `<span data-wrap><span class="t--secondary">#+${metaKey}: </span><span data-meta-value>${metaValue}</span>\n</span>`;
          console.error(`Unsupported meta key ${metaKey}`);
      }

      return {
        lengthChange: 2 + metaKey.length + 2 + metaValue.length + 1 - raw.length,
        lineType: "meta",
      };
    }

    // blank line
    match = rawText.match(/^(\s+)$/);
    if (match) {
      const [raw, spaces] = match;

      line.dataset.line = "blank";

      const inlineSpaces = removeLineEnding(spaces);

      const indent = config.syntaxOnly ? inlineSpaces : ` `.repeat(context.indentFromHeading + context.indentFromList);
      line.innerHTML = `<span data-indent>${indent}</span><span data-empty-content>\n</span>`;

      return {
        lengthChange: indent.length + 1 - raw.length,
        lineType: "",
      };
    }

    // paragraph
    let paragraphHtml = "";
    let remainingText = removeLineEnding(rawText);
    let indent: string;
    let actualIndent = remainingText.match(/^(\s+)/)?.[0] ?? "";
    let paragraphLength = 0;

    if (config.syntaxOnly) {
      indent = actualIndent;
      remainingText = remainingText.slice(indent.length);
    } else {
      indent = ` `.repeat(context.indentFromHeading + context.indentFromList);
      remainingText = remainingText.trimStart();
    }

    paragraphLength = remainingText.length;

    while (remainingText) {
      let match = remainingText.match(/^(.*?)\[([^\[\]]+?)\]\((.+?)\)/); // [title](target)
      if (match) {
        const [raw, plainText, linkTitle, linkTarget] = match;
        paragraphHtml += plainText;
        paragraphHtml += `<span data-link class="t--ghost"><span class="link__title">[${linkTitle}]</span>(<span data-title-target="${linkTarget}" class="link__target">${linkTarget}</span>)</span>`;

        remainingText = remainingText.slice(raw.length);
        continue;
      }

      match = remainingText.match(URL_PATTERN_WITH_PREFIX); // raw URL
      if (match) {
        const [raw, plainText, url] = match;
        paragraphHtml += plainText;
        paragraphHtml += `<span data-url="${url}">${url}</span>`;

        remainingText = remainingText.slice(raw.length);
        continue;
      }

      paragraphHtml += remainingText;
      remainingText = "";
    }

    line.innerHTML = `<span data-indent>${indent}</span><span data-wrap>${paragraphHtml}\n</span>`;

    return {
      lengthChange: indent.length + paragraphLength + 1 - rawText.length,
      lineType: "",
    };
  }

  isIndentPollutingLineType(lineType?: string): boolean {
    return ["heading", "list", "blank"].includes(lineType as LineType);
  }

  isIndentResetLineType(lineType?: string): boolean {
    return (lineType as LineType) === "heading";
  }
}
