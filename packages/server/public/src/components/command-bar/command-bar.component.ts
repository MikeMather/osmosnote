import { ApiService } from "../../services/api/api.service.js";
import { ComponentRefService } from "../../services/component-reference/component-ref.service.js";
import { NotificationService } from "../../services/notification/notification.service.js";
import { RemoteHostService } from "../../services/remote/remote-host.service.js";
import { RouteService } from "../../services/route/route.service.js";
import { WindowRefService } from "../../services/window-reference/window.service.js";
import { di } from "../../utils/dependency-injector.js";
import { scrollIntoView } from "../../utils/scroll-into-view.js";
import { CaretService } from "../text-editor/caret.service.js";
import { CompileService } from "../text-editor/compiler/compile.service.js";
import { SyncService } from "../text-editor/sync.service.js";
import { TrackChangeService } from "../text-editor/track-change.service.js";
import { commandTree } from "./command-tree.js";
import { MenuRowComponent, PayloadAction } from "./menu/menu-row.component.js";
import { renderChildCommands } from "./menu/render-menu.js";

customElements.define("s2-menu-row", MenuRowComponent);

export interface CommandInput {
	command: string;
	args?: string;
}

export const EMPTY_COMMAND: CommandInput = {
	command: "",
};

export interface CommandHandlerContext {
	componentRefs: ComponentRefService;
	apiService: ApiService;
	remoteHostService: RemoteHostService;
	windowRef: WindowRefService;
	notificationService: NotificationService;
	syncService: SyncService;
	formatService: CompileService;
	routeService: RouteService;
	trackChangeService: TrackChangeService;
}

export interface CommandHandler {
	(props: { input: CommandInput; context: CommandHandlerContext }):
		| CommandHandlerResult
		| Promise<CommandHandlerResult>;
}

export interface CommandHandlerResult {
	/**
	 * run when input changes
	 * return the html for the dropdown
	 */
	updateDropdownOnInput?: () => string | Promise<string>;
	/**
	 * run when keydown sequence matches the command
	 */
	runOnMatch?: () => any;
	/**
	 * run when the command is committed with "Enter" key
	 */
	runOnCommit?: () => any;
	/**
	 * run when the command is committed with "Enter" key.
	 * After commit, command bar remains open with args removed.
	 */
	repeatableRunOnCommit?: () => any;
}

export interface RegisteredCommand {
	name: string;
	key: string;
	commands?: RegisteredCommand[];
	handler?: CommandHandler;
}

export class CommandBarComponent extends HTMLElement {
	readonly dataset!: {
		active?: "true";
	};

	commandInputDom!: HTMLInputElement;
	commandOptionsDom!: HTMLElement;
	commandTree!: RegisteredCommand;

	private componentRefs = di.getSingleton(ComponentRefService);
	private apiService = di.getSingleton(ApiService);
	private remoteHostService = di.getSingleton(RemoteHostService);
	private windowRef = di.getSingleton(WindowRefService);
	private notificationService = di.getSingleton(NotificationService);
	private syncService = di.getSingleton(SyncService);
	private formatService = di.getSingleton(CompileService);
	private routeService = di.getSingleton(RouteService);
	private caretService = di.getSingleton(CaretService);
	private trackChangeService = di.getSingleton(TrackChangeService);

	private isExiting = false;

	constructor() {
		super();

		this.commandTree = commandTree;
	}

	connectedCallback() {
		this.innerHTML = /*html*/ `
      <input id="command-input" class="cmdbr-input" disabled tabindex="-1" type="text" autocomplete="off" spellcheck="false" data-active/>
      <div id="command-options" class="cmdbr-dropdown"></div>`;

		this.commandInputDom = document.getElementById("command-input") as HTMLInputElement;
		this.commandOptionsDom = document.getElementById("command-options") as HTMLUListElement;

		this.handleEvents();
	}

	toggleCommandMode() {
		if (this.dataset.active) {
			this.exitCommandMode();
		} else {
			this.enterCommandMode()
		}
	}

	enterCommandMode(initialInput?: string) {
		this.dataset.active = "true";
		this.commandInputDom.tabIndex = 0; // make it focusable AFTER command mode starts. Otherwise, we will trap focus for the rest of the window
		this.commandInputDom.disabled = false;
		if (initialInput) {
			this.commandInputDom.value = initialInput;
		}
		this.commandInputDom.focus();
	}

	exitCommandMode() {
		if (this.isExiting) return;

		this.isExiting = true;
		// restore focus will cause selection change, which triggers focusOut, which triggers exitCommandMode again.
		// hence using `isExiting` to prevent double handling.
		this.restoreFocus();

		this.clear();
		this.commandInputDom.disabled = true; // this will eject focus
		this.commandInputDom.tabIndex = -1;
		delete this.dataset.active;
		this.isExiting = false;
	}

	isInCommandMode() {
		return document.activeElement === this.commandInputDom;
	}

	clear() {
		this.commandInputDom.value = "";
		this.commandOptionsDom.innerHTML = "";
	}

	private restoreFocus() {
		// assumption, command bar can only be opened by text editor
		// so we always restore focus to the caret.
		this.caretService.restoreCaretSelectionlFromModel();
	}

	private parseInput(input: string): CommandInput {
		const command = input.split(" ")[0];
		const args = input.split(" ").slice(1).join(" ");

		return {
			command,
			args,
		};
	}

	private handleEvents() {
		this.addEventListener('click', (e) => {
			const clicked = e.target as MenuRowComponent;
			const event = new KeyboardEvent('Enter', { key: 'Enter' });
			const key = clicked.innerText.split('[')[1].split(']')[0];
			const target = this.commandOptionsDom.querySelector(`s2-menu-row[data-command-key="${key}"]`) as MenuRowComponent;
			if (!target) return;
			const handled = this.handleOptionKeydown({ optionDom: target, event });
		});

		this.commandOptionsDom.addEventListener("focusout", (event) => {
			if (this.contains(event.relatedTarget as Node)) return;

			this.exitCommandMode();
		});

		this.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();

				this.exitCommandMode();
			}
		});

		this.commandInputDom.addEventListener("focus", (event) => {
			this.handleInput(this.commandInputDom.value);
		});

		this.commandInputDom.addEventListener("keydown", async (event) => {
			const activeOption = this.commandOptionsDom.querySelector(
				`s2-menu-row[data-kind="option"][data-active]`
			) as MenuRowComponent;
			if (activeOption) {
				const handled = this.handleOptionKeydown({ optionDom: activeOption, event: event });

				if (handled) {
					event.stopPropagation();
					event.preventDefault();
					return;
				}
			}

			if (event.key === "Backspace") {
				// handle backspace manually when it's trailing the command name, otherwise, auto trailling space will be added immediately
				if (this.commandInputDom.value.indexOf(" ") === this.commandInputDom.value.length - 1) {
					this.commandInputDom.value = this.commandInputDom.value.trimEnd();
					event.preventDefault();
					event.stopPropagation();
				}
			}

			const verticleMotion = this.getVerticleMotion(event);
			if (verticleMotion) {
				event.preventDefault();
				event.stopPropagation();

				const allOptions = [
					this.commandInputDom,
					...this.commandOptionsDom.querySelectorAll(`s2-menu-row[data-kind="option"]`),
				] as MenuRowComponent[];
				let currentOptionIndex = allOptions.findIndex((option) => option.dataset.active === "");

				if (currentOptionIndex < 0) {
					currentOptionIndex = 0; // the input itself must be active when none of the options are active
				}

				const newIndex =
					(currentOptionIndex + (verticleMotion === "up" ? allOptions.length - 1 : 1)) % allOptions.length;

				allOptions.forEach((option) => delete option.dataset.active);
				const newActiveOption = allOptions[newIndex];
				// filter out the input element
				if (newActiveOption.dataset.kind === "option") {
					newActiveOption.dataset.active = "";
					this.handleOptionFocus({ optionDom: newActiveOption });
				}
			}

			if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();

				const executableCommand = await this.buildCommand();
				if (executableCommand?.runOnCommit) {
					this.exitCommandMode();
					executableCommand.runOnCommit();
				}

				if (executableCommand?.repeatableRunOnCommit) {
					const savedInput = this.parseInput(this.commandInputDom.value);
					this.exitCommandMode();
					executableCommand.repeatableRunOnCommit();

					// skip an update cycle to allow command to be digested
					setTimeout(() => {
						this.enterCommandMode();
						// remove args to get ready for the next run
						this.commandInputDom.value = savedInput.command;
						this.handleInput(this.commandInputDom.value);
					});
				}
			}
		});

		this.commandInputDom.addEventListener("input", async (e) => {
			this.handleInput((e.target as HTMLInputElement).value);
		});
	}

	private getVerticleMotion(event: KeyboardEvent): "up" | "down" | null {
		if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) || (event.key === "k" && event.ctrlKey)) {
			return "up";
		} else if (event.key === "ArrowDown" || event.key === "Tab" || (event.key === "j" && event.ctrlKey)) {
			return "down";
		}

		return null;
	}

	private async handleInput(input: string) {
		const currentInput = this.parseInput(input);
		const command = this.matchCommand(currentInput);

		// command has child commands, render options
		if (command?.commands?.length) {
			this.commandOptionsDom.innerHTML = renderChildCommands(command.commands);
			return;
		}

		const executableCommand = await this.buildCommand();
		if (!executableCommand) return;

		if (executableCommand.runOnMatch) {
			this.exitCommandMode();

			executableCommand.runOnMatch();
			return;
		}

		if (executableCommand.updateDropdownOnInput) {
			const dropdownHtml = await executableCommand.updateDropdownOnInput();

			// it is possible the dropdown html arrives after the user commits the query
			if (this.isInCommandMode()) {
				this.commandOptionsDom.innerHTML = dropdownHtml;
			}
		}

		// add auto trailing space
		if (input.indexOf(" ") < 0) {
			this.commandInputDom.value = `${this.commandInputDom.value} `;
		}
	}

	/**
	 * Triggered when an option is focused with up down arrow, but not executed yet
	 */
	private handleOptionFocus(props: { optionDom: MenuRowComponent }) {
		const optionDom = props.optionDom;
		// optionDom.scrollIntoView();

		scrollIntoView(optionDom, this.commandOptionsDom);

		if (optionDom.dataset.autoComplete) {
			const currentInput = this.parseInput(this.commandInputDom.value);
			this.commandInputDom.value = `${currentInput.command} ${optionDom.dataset.autoComplete}`;
		}
	}

	/**
	 * @return {boolean} whether the processing should stop after
	 */
	private handleOptionKeydown(props: { optionDom: MenuRowComponent; event: KeyboardEvent }): boolean {
		const targetDataset = props.optionDom.dataset;
		const e = props.event;
		console.log(targetDataset, e);
		if (e.key === "Enter") {
			if (targetDataset.commandKey) {
				this.commandInputDom.value = this.commandInputDom.value + targetDataset.commandKey;
				this.handleInput(this.commandInputDom.value);

				return true;
			}

			if (targetDataset.payload && targetDataset.payloadAction) {
				const shouldOpenInNew = e.ctrlKey || targetDataset.alwaysNewTab === "true";

				switch (targetDataset.payloadAction) {
					case PayloadAction.openNoteById:
						window.open(`/?id=${targetDataset.payload}`, shouldOpenInNew ? "_blank" : "_self");
						this.exitCommandMode();
						return true;
					case PayloadAction.openNoteByUrl:
						window.open(targetDataset.payload, shouldOpenInNew ? "_blank" : "_self");
						this.exitCommandMode();
						return true;
					case PayloadAction.insertNewNoteByUrl:
						this.componentRefs.textEditor.insertNoteLinkOnSave(targetDataset.payload);
						this.exitCommandMode();
						return true;
					case PayloadAction.insertText:
						this.componentRefs.textEditor.insertAtCaret(targetDataset.payload);
						this.exitCommandMode();
						return true;
					case PayloadAction.linkToNewNoteByUrl:
						const url = targetDataset.payload;
						this.componentRefs.textEditor.linkToNoteOnSave(url);
						this.exitCommandMode();
						return true;
					case PayloadAction.linkToNoteById:
						const id = targetDataset.payload;
						this.componentRefs.textEditor.insertAtCaretWithContext((context) => `[${context.textSelected}](${id})`);
						this.exitCommandMode();
						return true;
					default:
						const unknownAction: never = targetDataset.payloadAction;
						throw new Error(unknownAction);
				}
			}
		}

		return false;
	}

	private async buildCommand() {
		const currentInput = this.parseInput(this.commandInputDom.value);

		const command = this.matchCommand(currentInput);

		const handler = command?.handler;

		if (handler) {
			const result = await handler({
				input: currentInput,
				context: {
					componentRefs: this.componentRefs,
					apiService: this.apiService,
					remoteHostService: this.remoteHostService,
					windowRef: this.windowRef,
					notificationService: this.notificationService,
					syncService: this.syncService,
					formatService: this.formatService,
					routeService: this.routeService,
					trackChangeService: this.trackChangeService,
				},
			});

			return result;
		} else {
			return null;
		}
	}

	private matchCommand(input: CommandInput): RegisteredCommand | null {
		let currentCommand = commandTree;

		const chars = input.command.split("");

		for (let char of chars) {
			const childMatch = currentCommand.commands?.find((c) => c.key === char);
			if (!childMatch) {
				return null;
			}

			currentCommand = childMatch;
		}

		return currentCommand;
	}
}
