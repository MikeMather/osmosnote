import type { NoteListReply } from "@system-two/server/src/routes/note-list";
import type { SearchResult } from "@system-two/server/src/routes/search";
import type { CommandHandler } from ".";
import { filenameToId } from "../../../lib/id";

export const handleSearchNote: CommandHandler = async ({ command, execute }) => {
  const phrase = command.args;

  if (!execute) {
    let optionsHtml = /*html*/ `<div class="cmdbr-option cmdbr-option--header">"Enter" to open, "y" to copy link</div>`;

    if (phrase?.length) {
      const params = new URLSearchParams({
        phrase,
      });

      const response = await fetch(`/api/search?${params.toString()}`);
      const result: SearchResult = await response.json();

      optionsHtml += result.items
        .map(
          (item) => /*html*/ `
          <div class="cmdbr-option cmdbr-option--btn" data-option data-open-by-id="${filenameToId(
            item.filename
          )}" data-copy-text="[${item.title}](${filenameToId(item.filename)})">${item.title}</div>`
        )
        .join("");
    } else {
      // load recent notes
      const response = await fetch(`/api/notes`);
      const result: NoteListReply = await response.json();
      optionsHtml += result.notes
        .map(
          (item) =>
            /*html*/ `<div class="cmdbr-option cmdbr-option--btn" data-option data-open-by-id="${filenameToId(
              item.filename
            )}" data-copy-text="[${item.title}](${filenameToId(item.filename)})">${item.title}</div>`
        )
        .join("");
    }

    return {
      optionsHtml,
    };
  } else {
    return {};
  }
};
