import { di } from "../../../utils/dependency-injector.js";
import { ComponentRefService } from "../../../services/component-reference/component-ref.service.js";

  
  export class MobileAccessComponent extends HTMLElement {

    private button: HTMLButtonElement | null = null;

    toggleCommandBar() {
      di.getSingleton(ComponentRefService).commandBar.toggleCommandMode();
    }

    connectedCallback() {
      this.innerHTML = /*html*/ `<div id="mobile-cmdbar-access" class="mobile-cmdbar-access">
        <span># Menu</span>
      </div>`;

      this.button = this.querySelector("#mobile-cmdbar-access") as HTMLButtonElement;
      this.button.addEventListener('click', this.toggleCommandBar)
    }

    disconnectedCallback() {
        this.button?.removeEventListener('click', this.toggleCommandBar);
    }
  }
  