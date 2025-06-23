import { Plugin, Notice, requestUrl } from "obsidian";

import { 
  FolderName,
  URLString,
  FolderUpdater,
  InstalledFolderRecord,
  VNMListUpdater,
  VNMMetadata,
  VNMUpdater
} from "./update";

interface VNPluginData {
  canonicalVNMs: Record<FolderName, URLString>;
  knownFolders: Record<FolderName, VNMMetadata>;
  lastUpdatedTimes: Record<string, number>;
  installedFolders: Record<FolderName, InstalledFolderRecord>;
}

const DEFAULT_DATA: VNPluginData = {
  canonicalVNMs: {},
  knownFolders: {},
  lastUpdatedTimes: {},
  installedFolders: {},
};

export default class VinayaNotebookPlugin extends Plugin {
  data: VNPluginData;

  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());

    setTimeout(async () => {
      await this.initiate_background_update();
    }, 1000); // Wait until after the plugin is loaded to not lock up the UI
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
