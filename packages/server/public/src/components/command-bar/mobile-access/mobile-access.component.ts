import { di } from "../../../utils/dependency-injector.js";
import { ComponentRefService } from "../../../services/component-reference/component-ref.service.js";

  
  export class MobileAccessComponent extends HTMLElement {

    private button: HTMLButtonElement | null = null;

    openCommandBar() {
      di.getSingleton(ComponentRefService).commandBar.enterCommandMode();
    }

    connectedCallback() {
      this.innerHTML = /*html*/ `<div id="mobile-cmdbar-access" class="mobile-cmdbar-access">
        <span># Menu</span>
      </div>`;

      this.button = this.querySelector("#mobile-cmdbar-access") as HTMLButtonElement;
      this.button.addEventListener('click', this.openCommandBar)
    }

    disconnectedCallback() {
        this.button?.removeEventListener('click', this.openCommandBar);
    }
  }
  