import { MarkdownView, Notice, Plugin, TAbstractFile, TFile } from "obsidian";

import { 
  FolderName,
  URLString,
  FolderUpdater,
  InstalledFolderRecord,
  VNMListUpdater,
  VNMMetadata,
  VNMUpdater,
  SubmoduleMetadata
} from "./update";
import {
  checkAppSettings,
} from "./appsettings";
import openNuxModelWhenReady from "./nux";
import { VinayaBookshelfSettingsTab } from "./pluginsettings";
import NewModuleModal from "./newmodulemodal";
import { deepMergeTrie, trieHasPath } from "./helpers";

interface VBPluginData {
  canonicalVNMs: Record<FolderName, URLString>;
  userVNMs: Record<FolderName, URLString>;
  knownFolders: Record<FolderName, VNMMetadata>;
  lastUpdatedTimes: Record<string, number>;
  installedFolders: Record<FolderName, InstalledFolderRecord>;
  disabledSettingsCheck: number; // TODO Add a toggle in the settings panel
  nuxShown: number;
  folderOptOuts: Array<FolderName>;
}

const DEFAULT_DATA: VBPluginData = {
  canonicalVNMs: {},
  userVNMs: {},
  knownFolders: {},
  lastUpdatedTimes: {},
  installedFolders: {},
  disabledSettingsCheck: 0,
  nuxShown: 0,
  folderOptOuts: [],
};

export default class VinayaBookshelfPlugin extends Plugin {
  data: VBPluginData;
  settingsChecker: NodeJS.Timeout;
  settingsTab: VinayaBookshelfSettingsTab;
  personalFolderName: FolderName;

  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    this.personalFolderName = "checkAppSettings will set this";

    this.settingsTab = new VinayaBookshelfSettingsTab(this);
    this.addSettingTab(this.settingsTab);

    this.registerEvent(
      this.app.workspace.on("file-open", this.onFileOpen.bind(this))
    );

    this.registerEvent(
      this.app.vault.on("delete", this.onDelete.bind(this))
    );

    this.addCommand({
      id: "force-update",
      name: "Update modules now",
      callback: this.force_update.bind(this),
    });

    // Defer checks until everything is loaded
    setTimeout(() => {void (async () => {
      if (!this.data.nuxShown) {
        new Notice("The vinaya bookshelf plugin is enabled!");
        if (!Object.entries(this.data.canonicalVNMs).length) {
          // Initialize with a basic set in case the canonical url is down
          this.data.canonicalVNMs =  {
            "Ajahn Brahmali": "https://github.com/obu-labs/brahmali-vinaya-notes/releases/latest/download/manifest.vnm",
            "Canon (Pali)": "https://github.com/obu-labs/pali-vinaya-notes/releases/latest/download/manifest.vnm",
            "Bhante Suddhaso": "https://github.com/obu-labs/suddhaso-vinaya-notes/releases/latest/download/manifest.vnm",
          };
          await this.save();
        }
      }
      await this.initiate_background_update();
      if (!this.data.nuxShown) {
        await openNuxModelWhenReady(this);
      }
    })(); }, 1500);
  }

  onunload() {
    clearTimeout(this.settingsChecker);
  }

  async save() {
    await this.saveData(this.data);
  }

  *knownVNMs(): Generator<FolderName> {
    for (const folder_name in this.data.canonicalVNMs) {
      yield folder_name;
    }
    for (const folder_name in this.data.userVNMs) {
      yield folder_name;
    }
  }

  installed_modules_relying_on(folder_name: FolderName): Array<string> {
    const ret: Array<FolderName> = [];
    for (const installed_folder_name in this.data.installedFolders) {
      const extant_folder = this.app.vault.getFolderByPath(installed_folder_name);
      if (!extant_folder) {
        continue;
      }
      const folder_vnm = this.data.knownFolders[installed_folder_name];
      if (folder_vnm && folder_vnm.requires[folder_name]) {
        ret.push(installed_folder_name);
      } else {
        // check if any of its submodules require this folder
        if (!folder_vnm || !folder_vnm.submodules) {
          continue;
        }
        for (const submodule of folder_vnm.submodules) {
          if (submodule.requires[folder_name]) {
            ret.push(installed_folder_name + " > " + submodule.name);
            break;
          }
        }
      }
    }
    return ret;
  }

  installed_modules_relying_on_submodule(folder_name: FolderName, submodule: SubmoduleMetadata): Array<string> {
    const ret: Array<FolderName> = [];
    for (const installed_folder_name in this.data.installedFolders) {
      const extant_folder = this.app.vault.getFolderByPath(installed_folder_name);
      if (!extant_folder) {
        continue;
      }
      const folder_vnm = this.data.knownFolders[installed_folder_name];
      if (!folder_vnm) {
        continue;
      }
      let merged_reqs = Object.assign({}, folder_vnm.requires);
      if (folder_vnm.submodules) {
        for (const submodule of folder_vnm.submodules) {
          if (this.data.folderOptOuts.contains(installed_folder_name + "/" + submodule.name)) {
            continue;
          }
          merged_reqs = deepMergeTrie(merged_reqs, submodule.requires);
        }
      }
      for (const path of submodule.paths) {
        const pathParts = path.split("/");
        pathParts.unshift(folder_name);
        if (trieHasPath(merged_reqs, pathParts)) {
          ret.push(installed_folder_name);
          break;
        }
      }
    }
    return ret;
  }

  async initiate_background_update() {
    this.settingsTab.setIsUpdating(true);
    const root_updater = new VNMListUpdater(this);
    if (root_updater.needs_update()) {
      await root_updater.update();
    }

    const updatePromises: Promise<void>[] = [];
    for (const folder_name of this.knownVNMs()) {
      const vnm_updater = new VNMUpdater(this, folder_name);
      if (vnm_updater.needs_update()) {
        updatePromises.push(vnm_updater.update());
      }
    }
    await Promise.all(updatePromises);
    
    if (!this.data.nuxShown) {
      return; // Let the NUX handle the rest
    }
    
    if (!this.data.disabledSettingsCheck) {
      await checkAppSettings(this);
    }

    await this.update_folders();
    this.settingsTab.setIsUpdating(false);
  }

  async update_folders(): Promise<boolean> {
    const downloadPromises: Promise<void>[] = [];
    let did_open_model = false;
    for (const folder_name in this.data.canonicalVNMs) {
      const folder_updater = new FolderUpdater(this, folder_name);
      const folder = this.app.vault.getFolderByPath(folder_name);
      if (folder) {
        if (folder_updater.needs_update()) {
          downloadPromises.push(folder_updater.update());
        }
      } else { // If the folder doesn't exist
        if (folder_updater.is_installed()) {
          if (folder_updater.subscribed()) {
            // ... but was installed, this means someone deleted the folder
            // out from under us. So, offer to reinstall it (or unsubscribe)
            new NewModuleModal(this, folder_updater).open();
            did_open_model = true;
          } else {
            delete this.data.installedFolders[folder_name];
            await this.save();
          }
        } else { // Was not installed
          if (folder_updater.subscribed()) {
            // This genuinely is a new folder?
            new NewModuleModal(this, folder_updater).open();
            did_open_model = true;
          }
        }
      }
    }
    await Promise.all(downloadPromises);
    return downloadPromises.length > 0 || did_open_model;
  }

  last_updated_time(): number {
    let ret = this.data.lastUpdatedTimes["VNMList"] || Infinity;
    for (const folder_name in this.data.canonicalVNMs) {
      ret = Math.min(ret, this.data.lastUpdatedTimes[folder_name+" VNM"] || Infinity);
    }
    return ret;
  }

  async force_update() {
    const original_notice = new Notice("Checking for updates...");
    this.settingsTab.setIsUpdating(true);
    const root_updater = new VNMListUpdater(this);
    await root_updater.update();
    const updatePromises: Promise<void>[] = [];
    for (const folder_name of this.knownVNMs()) {
      const vnm_updater = new VNMUpdater(this, folder_name);
      updatePromises.push(vnm_updater.update());
    }
    await Promise.all(updatePromises);
    const did_update = await this.update_folders();
    original_notice.hide();
    if (!did_update) {
      new Notice("No updates available.");
    }
    this.settingsTab.setIsUpdating(false);
  }

  isSyncedFile(file: TFile): boolean {
    for (const folder_name in this.data.installedFolders) {
      if (file.path.startsWith(folder_name + "/")) {
        return true;
      }
    }
    return false;
  }

  isPersonalFile(file: TFile): boolean {
    if (file.path.startsWith(this.personalFolderName + "/")) {
      return true;
    }
    return false;
  }

  onDelete(file: TAbstractFile) {
    if (file instanceof TFile) {
      return;
    }
    if (this.data.installedFolders[file.path]) {
      const folder_updater = new FolderUpdater(this, file.path);
      folder_updater.unsubscribe(true);
    }
    const puntkey = file.path + " Folder Punted";
    if (this.data.lastUpdatedTimes[puntkey]) {
      delete this.data.lastUpdatedTimes[puntkey];
      this.save();
    }
  }

  // Make sure that Synced files are always opened in preview mode
  // And make sure to switch back to editor mode for personal files
  onFileOpen(file: TFile | null) {
    if (!file) return;
    setTimeout(() => {
      const activeLeaf = this.app.workspace.getLeaf(false);
      const viewState = activeLeaf.getViewState();
      if (!viewState.state) viewState.state = {}
      const activeView = activeLeaf.view;
      if (activeView instanceof MarkdownView) {
        if (activeView.file !== file) return;
      } else {
        return;
      }

      if (this.isSyncedFile(file)) {
        if (viewState.state.mode === "source") {
          if (!viewState.state) viewState.state = {} 
          viewState.state.mode = "preview";
          activeLeaf.setViewState(viewState);
        }
      } else {
        if (this.isPersonalFile(file)) {
          if (viewState.state.mode === "preview") { 
            viewState.state.mode = "source";
            activeLeaf.setViewState(viewState);
            activeView.editor.focus();
          }
        }
      }
    }, 50); // Seems a good balance between reliability and speed in testing
  }
}
