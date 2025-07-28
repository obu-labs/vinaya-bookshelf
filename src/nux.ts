import { ButtonComponent, Modal, normalizePath, Notice, setIcon, Setting } from "obsidian";
import VinayaBookshelfPlugin from "./main";
import {
  is_settings_modal_open,
  app_settings_path,
  get_app_settings,
  recommended_app_settings,
  checkAppSettings
} from "./appsettings";
import { FolderUpdater } from "./update";

const INITIAL_NEW_FILE_PATH = "My Drafts";

class NuxModal extends Modal {
  plugin: VinayaBookshelfPlugin;
  folderNameSpan: HTMLSpanElement;
  submit_button: ButtonComponent;
  constructor(plugin: VinayaBookshelfPlugin) {
    const app = plugin.app;
    super(app);
    this.plugin = plugin;
    this.modalEl.addClass("nux-modal");

    const first_page = this.contentEl.createDiv({ cls: "nux-modal-page" });
    const second_page = this.contentEl.createDiv({ cls: "nux-modal-page hidden" });
    const header = first_page.createDiv({ cls: "nux-modal-header" });
    header.createEl("h1", { text: "Welcome", cls: "nux-modal-title" });
    header.createEl("h2", { text: "To the Vinaya Bookshelf!", cls: "nux-modal-subtitle" });
    header.createEl("p", { text: "Your home for studying the Buddhist Monastic rules." });

    const settings = first_page.createDiv({ cls: "nux-modal-settings" });
    let name = "";
    new Setting(settings)
      .setName('Your Name')
      .addText((text) =>
        text.setValue(name).onChange((value) => {
          name = value;
          this.submit_button.setDisabled(name.length < 2);
        }));
    settings.createEl("p", { text: "This will be the name of your own notebook on the shelf: the folder where your notes will be stored. You can change this later in \"File and Link\" settings. Vinaya Bookshelf does not collect any information about its users." });

    new Setting(first_page)
      .addButton((btn) => {
        btn
          .setButtonText('Submit')
          .setDisabled(name.length < 2)
          .setCta()
          .onClick(() => {
            this.submit(name);
            this.folderNameSpan.setText(name);
            first_page.addClass("hidden");
            second_page.removeClass("hidden");
          });
        this.submit_button = btn;
      });
    
    const second_header = second_page.createDiv({ cls: "nux-modal-header" });
    second_header.createEl("h2", { text: "How the Bookshelf Works", cls: "nux-modal-title" });
    let p = second_header.createEl("p", { text: "Your folder " });
    this.folderNameSpan = p.createSpan({ cls: "folder-name" });
    p.createSpan({ text: " will live alongside the following synced folders in this vault:" });
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
    second_page.createEl("p", { text: "The Vinaya Bookshelf Plugin will automatically update these folders, so don't modify them. Place your notes in your own folder which lives alongside these. To share your notebook with others, simply send them your folder. That's it!" });
    second_page.createEl("p", { text: "For more information about how Vinaya Bookshelf works, see " }).createEl("a", { text: "the documentation.", href: "https://labs.buddhistuniversity.net/vinaya/docs/guides" });
    
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
    name = normalizePath(name);
    app_settings["newFileFolderPath"] = name;
    app_settings["attachmentFolderPath"] = `${name}/attachments`;
    this.app.vault.adapter.mkdir(name);
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

export default async function openNuxModelWhenReady(plugin: VinayaBookshelfPlugin) {
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
    plugin.data.nuxShown = Date.now();
    await plugin.save();
    new NuxModal(plugin).open();
  }
}
