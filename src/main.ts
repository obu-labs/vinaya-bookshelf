import { Plugin, Notice, normalizePath } from "obsidian";

import { 
  FolderName,
  URLString,
  FolderUpdater,
  InstalledFolderRecord,
  VNMListUpdater,
  VNMMetadata,
  VNMUpdater
} from "./update";
import { checkAppSettings } from "./appsettings";

interface VNPluginData {
  canonicalVNMs: Record<FolderName, URLString>;
  knownFolders: Record<FolderName, VNMMetadata>;
  lastUpdatedTimes: Record<string, number>;
  installedFolders: Record<FolderName, InstalledFolderRecord>;
  disabledSettingsCheck: number; // TODO Add a toggle in the settings panel
}

const DEFAULT_DATA: VNPluginData = {
  canonicalVNMs: {},
  knownFolders: {},
  lastUpdatedTimes: {},
  installedFolders: {},
  disabledSettingsCheck: 0,
};

export default class VinayaNotebookPlugin extends Plugin {
  data: VNPluginData;
  settingsChecker: any;

  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());

    // All the things that take time should be off the critical path

    if (this.data.disabledSettingsCheck == 0) {
      setTimeout(async () => {
        await checkAppSettings(this);
      }, 1000);
    } // TODO: If they disabled some time ago, maybe ask them to reenable

    setTimeout(async () => {
      await this.initiate_background_update();
    }, 5000);
  }

  onunload() {
    clearTimeout(this.settingsChecker);
  }

  async save() {
    await this.saveData(this.data);
  }

  async initiate_background_update() {
    const root_updater = new VNMListUpdater(this);
    if (root_updater.needs_update()) {
      root_updater.update();
    }
    for (const folder_name in this.data.canonicalVNMs) {
      const vnm_updater = new VNMUpdater(this, folder_name);
      if (vnm_updater.needs_update()) {
        vnm_updater.update();
      }
      const folder_updater = new FolderUpdater(this, folder_name);
      if (folder_updater.needs_update()) {
        folder_updater.update();
      }
    }
  }
}
