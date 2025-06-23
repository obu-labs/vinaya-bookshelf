import { App, Modal, Notice, Setting } from "obsidian";
import VinayaNotebookPlugin from "./main";
import {
  is_settings_modal_open,
  app_settings_path,
  get_app_settings,
  recommended_app_settings
} from "./appsettings";
import { VNMListUpdater, VNMUpdater } from "./update";

const INITIAL_NEW_FILE_PATH = "My Drafts";

enum NuxPage {
  INITIAL = "initial",
}

class NuxModal extends Modal {
  page: NuxPage;
  constructor(app: App) {
    super(app);
    this.modalEl.addClass("nux-modal");
    this.page = NuxPage.INITIAL;

    const content = this.contentEl;
    const header = content.createDiv({ cls: "nux-modal-header" });
    header.createEl("h1", { text: "Welcome", cls: "nux-modal-title" });
    header.createEl("h2", { text: "To the Vinaya Notebook!", cls: "nux-modal-subtitle" });
    header.createEl("p", { text: "A private way to take and share your notes on the Monastic Discipline." });

    const settings = content.createDiv({ cls: "nux-modal-settings" });
    let name = "";
    new Setting(settings)
      .setName('Your Name')
      .addText((text) =>
        text.setValue(name).onChange((value) => {
          name = value;
        }));
    settings.createEl("p", { text: "This will be the name of the folder where your notes will be created. You can change this later in \"File and Link\" settings. Vinaya Notebook does not collect any personal information about its users." });

    new Setting(content)
      .addButton((btn) =>
        btn
          .setButtonText('Submit')
          .setCta()
          .onClick(() => {
            this.submit(name);
          }));
  }
  async submit(name: string) {
    new Notice(`Creating "${name}" folder...`);
    this.close();
  }
}

export default async function openNuxModelWhenReady(plugin: VinayaNotebookPlugin) {
  if (is_settings_modal_open()) {
    setTimeout(() => {
      openNuxModelWhenReady(plugin);
    }, 800);
  } else {
    let app_settings = await get_app_settings(this.app);
    if (app_settings["newFileFolderPath"] === undefined) {
      app_settings = Object.assign({}, 
        recommended_app_settings(INITIAL_NEW_FILE_PATH),
        app_settings
      );
      await this.app.vault.adapter.write(
        app_settings_path(this.app),
        JSON.stringify(app_settings, null, "2"),
      );
    }
    // Make sure we have the list of VNMs and that they are up to date
    // The Modal will handle downloading the folders as needed
    const listUpdater = new VNMListUpdater(plugin);
    await listUpdater.update();
    for (const folder_name in plugin.data.canonicalVNMs) {
      const vnm_updater = new VNMUpdater(plugin, folder_name);
      await vnm_updater.update();
    }
    new NuxModal(plugin.app).open();
  }
}
