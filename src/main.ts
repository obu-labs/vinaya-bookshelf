import { Notice, Plugin } from "obsidian";

import { 
  FolderName,
  URLString,
  FolderUpdater,
  InstalledFolderRecord,
  VNMListUpdater,
  VNMMetadata,
  VNMUpdater
} from "./update";
import {
  checkAppSettings,
} from "./appsettings";
import openNuxModelWhenReady from "./nux";

interface VNPluginData {
  canonicalVNMs: Record<FolderName, URLString>;
  knownFolders: Record<FolderName, VNMMetadata>;
  lastUpdatedTimes: Record<string, number>;
  installedFolders: Record<FolderName, InstalledFolderRecord>;
  disabledSettingsCheck: number; // TODO Add a toggle in the settings panel
  nuxShown: number;
}

const DEFAULT_DATA: VNPluginData = {
  canonicalVNMs: {},
  knownFolders: {},
  lastUpdatedTimes: {},
  installedFolders: {},
  disabledSettingsCheck: 0,
  nuxShown: 0,
};

export default class VinayaNotebookPlugin extends Plugin {
  data: VNPluginData;
  settingsChecker: any;

  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());

    // Defer checks until everything is loaded
    setTimeout(async () => {
      if (!this.data.nuxShown) {
        new Notice("The Vinaya Notebook Plugin is Enabled!");
        await openNuxModelWhenReady(this);
      } else {
        await this.initiate_background_update();
      }
    }, 500);
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
      await root_updater.update();
    }
    for (const folder_name in this.data.canonicalVNMs) {
      const vnm_updater = new VNMUpdater(this, folder_name);
      if (vnm_updater.needs_update()) {
        await vnm_updater.update();
      }
      const folder_updater = new FolderUpdater(this, folder_name);
      if (folder_updater.needs_update()) {
        await folder_updater.update();
      }
    }
    if (!this.data.disabledSettingsCheck) {
      await checkAppSettings(this);
    }
  }
}
