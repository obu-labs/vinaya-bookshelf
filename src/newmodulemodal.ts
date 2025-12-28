import { Modal } from "obsidian";
import VinayaBookshelfPlugin from "./main";
import { FolderUpdater } from "./update";

export default class NewModuleModal extends Modal {
  constructor(plugin: VinayaBookshelfPlugin, module: FolderUpdater) {
    super(plugin.app);

    this.setTitle("A new module is available!");
    this.modalEl.addClass("new-module-modal");
    const content = this.contentEl;

    content.createEl("p", { text: "A new folder is now available for your vault:" });
    const folder_info = content.createDiv({ cls: "folder-info" });
    folder_info.createEl("h5", { text: module.folder_name }).createEl("a", {
      href: plugin.data.knownFolders[module.folder_name].more_info,
      text: "source",
    });
    folder_info.createEl("p", {
      text: plugin.data.knownFolders[module.folder_name].description
    });
    content.createEl("p", { text: "Would you like to install this module?" });
    const buttonDiv = content.createDiv({ cls: "button-container" });
    buttonDiv.createEl("button", {
      text: `Don't subscribe to "${module.folder_name}"`,
    }).addEventListener("click", () => {
      void module.unsubscribe();
      this.close();
    });
    buttonDiv.createEl("button", {
      text: `Download and install "${module.folder_name}"`,
      cls: "mod-cta",
    }).addEventListener("click", () => {
      content.empty();
      const p = content.createEl("p", {
        text: "Great! Vinaya bookshelf will now download and install the new module in the background. You may close this dialog and continue to use the app but please don't close obsidian until the installation has completed."
      });
      content.createEl("button", {
        text: "Close",
        cls: "mod-cta close-button",
      }).addEventListener("click", () => {
        this.close();
      });
      module.update().then(() => {
        p.setText("Installation complete. You may now close this dialog.");
      }).catch(() => {
        p.setText("There was an error installing.");
      });
    })
  }
}

