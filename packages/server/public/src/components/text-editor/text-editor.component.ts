import { ApiService } from "../../services/api/api.service.js";
import { HistoryService } from "./history/history.service.js";
import { RouteService } from "../../services/route/route.service.js";
import { di } from "../../utils/dependency-injector.js";
import { CaretContext, CaretService } from "./caret.service.js";
import { EditService } from "./edit.service.js";
import { CompileService } from "./compiler/compile.service.js";
import { sourceToLines } from "./helpers/source-to-lines.js";
import { getNoteFromTemplate } from "./helpers/template.js";
import { InputService } from "./input.service.js";
import { MeasureService } from "./measure.service.js";
import { TrackChangeService } from "./track-change.service.js";
import { RemoteHostService } from "../../services/remote/remote-host.service.js";
import { NotificationService } from "../../services/notification/notification.service.js";
import { SyncService } from "./sync.service.js";
import { PreferencesService } from "../../services/preferences/preferences.service.js";

export interface InsertFunction {
  (context: CaretContext): string | Promise<string>;
}

export interface InsertContext {
  textBefore: string;
  textAfter: string;
  textSelected: string;
}

export class TextEditorComponent extends HTMLElement {
  private routeService!: RouteService;
  private noteService!: ApiService;
  private inputService!: InputService;
  private historyService!: HistoryService;
  private caretService!: CaretService;
  private editService!: EditService;
  private formatService!: CompileService;
  private measureService!: MeasureService;
  private trackChangeService!: TrackChangeService;
  private remoteHostService!: RemoteHostService;
  private notificationService!: NotificationService;
  private syncService!: SyncService;
  private preferencesService!: PreferencesService;

  private _host!: HTMLElement;

  get host() {
    return this._host;
  }

  connectedCallback() {
    this.innerHTML = /*html*/ `
    <div id="content-host" spellcheck="false" contenteditable="true"></div>`;

    this.routeService = di.getSingleton(RouteService);
    this.noteService = di.getSingleton(ApiService);
    this.inputService = di.getSingleton(InputService);
    this.historyService = di.getSingleton(HistoryService);
    this.caretService = di.getSingleton(CaretService);
    this.editService = di.getSingleton(EditService);
    this.formatService = di.getSingleton(CompileService);
    this.measureService = di.getSingleton(MeasureService);
    this.trackChangeService = di.getSingleton(TrackChangeService);
    this.remoteHostService = di.getSingleton(RemoteHostService);
    this.notificationService = di.getSingleton(NotificationService);
    this.syncService = di.getSingleton(SyncService);
    this.preferencesService = di.getSingleton(PreferencesService);

    this._host = this.querySelector("#content-host") as HTMLElement;

    this.init();
  }

  async init() {
    const { id, url, content, title } = this.routeService.getNoteConfigFromUrl();
    let note = "";
    if (id) {
      const data = await this.noteService.loadNote(id);
      note = data.note;
    } else {
      note = getNoteFromTemplate({ title, url, content });
    }

    this.syncService.checkAllFileVersions();

    const dom = sourceToLines(note);

    this.host.appendChild(dom);
    this.formatService.compile(this.host);

    this.caretService.init(this.host);
    this.measureService.init(this.host);
    this.inputService.init(this.host);

    this.historyService.save(this.host);

    const isNewNote = id === undefined;
    this.trackChangeService.set(isNewNote ? null : this.historyService.peek()!.textContent, false);

    const preferences = this.preferencesService.getPreferences();
    this.toggleSpellcheck(preferences.spellcheck);
  }

  async insertAtCaret(text: string) {
    await this.historyService.runAtomic(this.host, () => this.editService.caretPaste(text, this.host));
    this.trackChangeService.trackByText(this.historyService.peek()?.textContent);
  }

  getSelectedText(): string | null {
    return this.caretService.getCaretContext()?.textSelected ?? null;
  }

  /**
   * @return is spellcheck enabled after toggling
   */
  toggleSpellcheck(forceState?: boolean): boolean {
    const newState = forceState === undefined ? !this.host.spellcheck : forceState;
    this.host.spellcheck = newState;
    this.preferencesService.updatePreferences({ spellcheck: newState });

    return newState;
  }

  async insertAtCaretWithContext(getInsertingContent: InsertFunction) {
    const caretContext = this.caretService.getCaretContext();
    if (!caretContext) {
      throw new Error("Cannot insert when caret does not exist");
    }

    const insertingContent = await getInsertingContent(caretContext);

    await this.historyService.runAtomic(this.host, () => this.editService.caretPaste(insertingContent, this.host));
    this.trackChangeService.trackByText(this.historyService.peek()?.textContent);
  }

  async insertNoteLinkOnSave(openUrl: string) {
    this.remoteHostService.runOnNewNote(openUrl, (ev) => {
      const insertion = `[${ev.detail.title}](${ev.detail.id})`;
      this.insertAtCaret(insertion);
      this.notificationService.displayMessage(`Link inserted`);
    });
  }

  async linkToNoteOnSave(openUrl: string) {
    this.remoteHostService.runOnNewNote(openUrl, (ev) => {
      const id = ev.detail.id;
      this.insertAtCaretWithContext((context) => `[${context.textSelected}](${id})`);
      this.notificationService.displayMessage(`Link added`);
    });
  }
}
