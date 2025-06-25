import { App, Modal, normalizePath, Notice, setIcon, Setting } from "obsidian";
import VinayaNotebookPlugin from "./main";
import {
  is_settings_modal_open,
  app_settings_path,
  get_app_settings,
  recommended_app_settings,
  checkAppSettings
} from "./appsettings";
import { FolderUpdater, VNMListUpdater, VNMUpdater } from "./update";

const INITIAL_NEW_FILE_PATH = "My Drafts";

class NuxModal extends Modal {
  plugin: VinayaNotebookPlugin;
  folderNameSpan: HTMLSpanElement;
  constructor(plugin: VinayaNotebookPlugin) {
    const app = plugin.app;
    super(app);
    this.plugin = plugin;
    this.modalEl.addClass("nux-modal");

    const first_page = this.contentEl.createDiv({ cls: "nux-modal-page" });
    const second_page = this.contentEl.createDiv({ cls: "nux-modal-page hidden" });
    const header = first_page.createDiv({ cls: "nux-modal-header" });
    header.createEl("h1", { text: "Welcome", cls: "nux-modal-title" });
    header.createEl("h2", { text: "To the Vinaya Notebook!", cls: "nux-modal-subtitle" });
    header.createEl("p", { text: "A private way to take and share your notes on the Monastic Discipline." });

    const settings = first_page.createDiv({ cls: "nux-modal-settings" });
    let name = "";
    new Setting(settings)
      .setName('Your Name')
      .addText((text) =>
        text.setValue(name).onChange((value) => {
          name = value;
        }));
    settings.createEl("p", { text: "This will be the name of the folder where your notes will be created. You can change this later in \"File and Link\" settings. Vinaya Notebook does not collect any personal information about its users." });

    new Setting(first_page)
      .addButton((btn) =>
        btn
          .setButtonText('Submit')
          .setCta()
          .onClick(() => {
            this.submit(name);
            this.folderNameSpan.setText(name);
            first_page.addClass("hidden");
            second_page.removeClass("hidden");
          }));
    
    const second_header = second_page.createDiv({ cls: "nux-modal-header" });
    second_header.createEl("h2", { text: "How the Notebook Works", cls: "nux-modal-title" });
    let p = second_header.createEl("p", { text: "Your folder " });
    this.folderNameSpan = p.createSpan({ cls: "folder-name" });
    p.createSpan({ text: " will live alongside the following synced folders:" });
    const synced_folders = second_page.createEl("table", { cls: "nux-modal-synced-folders" });
    const thead = synced_folders.createEl("thead");
    const headrow = thead.createEl("tr");
    headrow.createEl("th", { text: "Folder Name" });
    headrow.createEl("th", { text: "Description" });
    headrow.createEl("th", { text: "Installed" });
    const tbody = synced_folders.createEl("tbody");
    for (const [folder_name, vnm] of Object.entries(this.plugin.data.knownFolders)) {
      const folder_row = tbody.createEl("tr");
      folder_row.createEl("th", { text: folder_name });
      folder_row.createEl("td", { text: vnm.description });
      const spinner = folder_row.createEl("td").createDiv({ cls: "loading-spinner" });
      this.download_folder(folder_name, spinner);
    }
    second_page.createEl("p", { text: "The Vinaya Notebook Plugin will automatically update these folders, so don't make any changes to them. Your personal folder is not backed up to the cloud or shared with anyone, but you're welcome to do so yourself! Simply copy your notes folder (with the same name!) into someone else's Vinaya Notes vault." });
    
    new Setting(second_page).addButton((btn) =>
      btn
        .setButtonText('Sounds Good!')
        .setCta()
        .onClick(() => {
          this.close();
        }));
  }
  async submit(name: string) {
    let app_settings = await get_app_settings(this.app);
    app_settings["newFileFolderPath"] = name;
    this.app.vault.adapter.mkdir(normalizePath(name));
    await this.app.vault.adapter.write(
      app_settings_path(this.app),
      JSON.stringify(app_settings, null, 2),
    );
    new Notice(`Your folder "${name}" has been created and set as the default for new notes!`);
    this.plugin.settingsChecker = setTimeout(async () => {
      await checkAppSettings(this.plugin);
    }, 60000);
  }
  async download_folder(folder_name: string, loading_spinner: HTMLDivElement) {
    const updater = new FolderUpdater(this.plugin, folder_name);
    updater.warn_about_overwrites = false;
    if (updater.needs_update()) {
      await updater.update();
      new Notice(`The "${folder_name}" folder has been downloaded!`);
    }
    loading_spinner.addClass("success");
    loading_spinner.removeClass("loading-spinner");
    setIcon(loading_spinner, "check-circle");
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
        JSON.stringify(app_settings, null, 2),
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
    plugin.data.nuxShown = Date.now();
    await plugin.save();
    new NuxModal(plugin).open();
  }
}
