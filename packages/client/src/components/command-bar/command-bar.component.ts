import { sendToClipboard } from "../../lib/clipboard";
import { di } from "../../lib/dependency-injector";
import { idToFilename } from "../../lib/id";
import { ComponentReferenceService } from "../../services/component-reference/component-reference.service";
import type { WithCursorService } from "../../services/cursor/cursor.service";
import "./command-bar.css";
import { commandTree } from "./command-tree";
import { commandHandlers } from "./handlers";

declare global {
  interface GlobalEventHandlersEventMap {
    // "command-bar:did-cancel": CustomEvent<never>;
    // "command-bar:did-execute": CustomEvent<never>;
  }
}

export interface CommandInput {
  command: string;
  args?: string;
}

export const EMPTY_COMMAND: CommandInput = {
  command: "",
};

export interface RegisteredCommand {
  name: string;
  key: string;
  /** Default to false */
  executeOnComplete?: boolean;
  /** Default to false */
  requireArguments?: boolean;
  commands?: RegisteredCommand[];
}

export class CommandBarComponent extends HTMLElement {
  commandInputDom!: HTMLInputElement;
  commandOptionsDom!: HTMLElement;
  commandTree!: RegisteredCommand;

  componentRefs = di.getSingleton(ComponentReferenceService);

  private triggeringElement: Element | null = null;

  constructor() {
    super();

    this.commandTree = commandTree;
  }

  connectedCallback() {
    this.innerHTML = /*html*/ `
      <input id="command-input" class="cmdbr-input" type="text" autocomplete="off" spellcheck="false"/>
      <div id="command-options" class="cmdbr-options"></div>`;

    this.commandInputDom = document.getElementById("command-input") as HTMLInputElement;
    this.commandOptionsDom = document.getElementById("command-options") as HTMLUListElement;

    this.handleEvents();
  }

  enterCommandMode() {
    this.saveCurosr();

    this.commandInputDom.focus();
  }

  exitCommandMode(config?: { skipCursorRestore?: boolean }) {
    this.clear();

    if (config?.skipCursorRestore) return;
    this.restoreCursor();
  }

  isInCommandMode() {
    return document.activeElement === this.commandInputDom;
  }

  clear() {
    this.commandInputDom.value = "";
    this.commandOptionsDom.innerHTML = "";
  }

  private saveCurosr() {
    this.triggeringElement = document.activeElement;

    const managedCursorComponent = this.triggeringElement?.closest("[data-managed-cursor]");
    if (managedCursorComponent) {
      (managedCursorComponent as WithCursorService).cursorService.save();
      this.triggeringElement = managedCursorComponent;
    }
  }

  private restoreCursor() {
    (this.triggeringElement as HTMLElement)?.focus?.();
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
    window.addEventListener("keydown", (event) => {
      if (event.key === "/") {
        if (this.isInCommandMode()) return; // Don't handle it if it's alreay active

        event.stopPropagation();
        event.preventDefault();

        this.enterCommandMode();
      }
    });

    this.addEventListener("focusout", (event) => {
      if (this.contains(event.relatedTarget as Node)) return;
      this.commandOptionsDom.innerHTML = "";
    });

    this.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();

        this.exitCommandMode();
      }
    });

    this.commandInputDom.addEventListener("focus", () => {
      this.handleInput(this.commandInputDom.value);
    });

    this.commandInputDom.addEventListener("keydown", (event) => {
      const activeOption = this.commandOptionsDom.querySelector("[data-option][data-active]") as HTMLElement;
      if (activeOption) {
        const handled = this.handleOptionKeydown(activeOption, event);
        if (handled) return;
      }

      if (event.key === "Backspace") {
        // handle backspace manually when it's trailing the command name, otherwise, auto trailling space will be added immediately
        if (this.commandInputDom.value.indexOf(" ") === this.commandInputDom.value.length - 1) {
          this.commandInputDom.value = this.commandInputDom.value.trimEnd();
          event.preventDefault();
          event.stopPropagation();
        }
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();

        const currentOption = this.commandOptionsDom.querySelector("[data-option][data-active]") as HTMLElement;
        if (currentOption) {
          const candidateOption =
            event.key === "ArrowDown" ? currentOption.nextElementSibling : currentOption.previousElementSibling;
          if (candidateOption?.matches("[data-option")) {
            (candidateOption as HTMLElement).dataset.active = "";
            delete currentOption.dataset.active;
          } else {
            // overflow, reset to input
            delete currentOption.dataset.active;
          }
        } else {
          const options = [...this.commandOptionsDom.querySelectorAll("[data-option]")] as HTMLElement[];
          const candidateOption = options[event.key === "ArrowDown" ? 0 : options.length - 1];
          if (candidateOption) {
            candidateOption.dataset.active = "";
          }
        }
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();

        this.executeCommand();
      }
    });

    this.commandInputDom.addEventListener("input", async (e) => {
      this.handleInput((e.target as HTMLInputElement).value);
    });
  }

  private async handleInput(input: string) {
    const currentInput = this.parseInput(input);
    const command = this.matchCommand(currentInput);

    // command has child commands, render options
    if (command?.commands?.length) {
      const optionsView = command.commands
        ?.map(
          (command) =>
            /*html*/ `<div data-command-key="${command.key}" data-option class="cmdbr-option cmdbr-option--btn">[${command.key}] ${command.name}</div>`
        )
        .join("");
      this.commandOptionsDom.innerHTML = optionsView;
      return;
    }

    // command has no child commands, and should execute and exit
    if (command?.executeOnComplete) {
      this.executeCommand();
      return;
    }

    // add auto trailing space when arguments are required
    if (command?.requireArguments && input.indexOf(" ") < 0) {
      this.commandInputDom.value = `${this.commandInputDom.value} `;
    }

    // command has no child commands, and should render options based on arguments
    this.updateCommandOptions();
  }

  /**
   * @return {boolean} whether the processing should stop after
   */
  private handleOptionKeydown(optionDom: HTMLElement, e: KeyboardEvent): boolean {
    const targetDataset = optionDom.dataset;

    if (targetDataset.copyText && e.key === "y") {
      e.stopPropagation();
      e.preventDefault();

      sendToClipboard(targetDataset.copyText);
      this.componentRefs.statusBar.showText(`[command-bar] copied "${targetDataset.copyText}"`);
      this.exitCommandMode();

      return true;
    }

    if (e.key === "Enter") {
      if (targetDataset.commandKey) {
        this.commandInputDom.value = this.commandInputDom.value + targetDataset.commandKey;
        this.handleInput(this.commandInputDom.value);

        return true;
      }

      if (targetDataset.openById) {
        window.open(`/?filename=${idToFilename(targetDataset.openById)}`, e.ctrlKey ? undefined : "_self");
        this.exitCommandMode();

        return true;
      }
    }

    return false;
  }

  private async updateCommandOptions() {
    const currentInput = this.parseInput(this.commandInputDom.value);

    const handler = commandHandlers[currentInput.command];

    if (typeof handler === "function") {
      const result = await handler({
        input: currentInput,
        context: {
          componentRefs: this.componentRefs,
        },
      });
      if (result.optionsHtml) {
        this.commandOptionsDom.innerHTML = result.optionsHtml;
      }
    }
  }

  private async executeCommand() {
    const currentInput = this.parseInput(this.commandInputDom.value);

    const handler = commandHandlers[currentInput.command];

    if (typeof handler === "function") {
      const result = await handler({
        input: currentInput,
        execute: true,
        context: {
          componentRefs: this.componentRefs,
        },
      });

      this.exitCommandMode({ skipCursorRestore: result.skipCursorRestore });
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
