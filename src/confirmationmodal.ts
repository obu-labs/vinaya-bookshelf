import { App, Modal } from "obsidian";

class ConfirmModal extends Modal {
  private resolve: (value: boolean) => void;

  constructor(
    app: App,
    heading: string,
    message: string | DocumentFragment,
    confirm_text: string,
    cancel_text: string,
    resolve: (value: boolean) => void,
  ) {
    super(app);
    this.resolve = resolve;

    this.modalEl.addClass("custom-confirm-modal");

    const content = this.contentEl;
    content.createEl("h3", { text: heading });
    if (message instanceof DocumentFragment) {
      content.appendChild(message);
    } else {
      content.createEl("p", { text: message });
    }

    const buttonContainer = content.createDiv({ cls: "modal-button-container" });

    const confirmBtn = buttonContainer.createEl("button", { text: confirm_text });
    confirmBtn.addClass("danger-button");
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.resolve(true);
    });

    const cancelBtn = buttonContainer.createEl("button", { text: cancel_text });
    cancelBtn.addClass("cancel-button");
    cancelBtn.addEventListener("click", () => {
      this.close();
      this.resolve(false);
    });
  }
}

/**
 * Creates a modal confirmation dialogue which you can `await` for a response.
 * 
 * @returns true if the user clicked the confirm button.
 */
export default async function confirmationModal(
  heading: string,
  message: string | DocumentFragment,
  app: App,
  confirm_text: string = "Do it",
  cancel_text: string = "Cancel",
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(
      app, heading, message, confirm_text, cancel_text, resolve
    ).open();
  });
}
