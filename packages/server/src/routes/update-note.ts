import { getConfig } from "../config";
import { createHandler } from "../lib/create-handler";
import { gitAdd } from "../lib/git";
import { writeNote } from "../lib/note-file-io";

export interface UpdateNoteInput {
  id: string;
  note: string;
}

export interface UpdateNoteOutput {
  note: string;
}

export const handleUpdateNote = createHandler<UpdateNoteOutput, UpdateNoteInput>(async (input) => {
  const id = input.id;
  const filename = `${id}.md`;
  const note = input.note;
  const config = await getConfig();

  await writeNote(filename, note);
  await gitAdd(config.notesDir);

  return {
    note,
  };
});
