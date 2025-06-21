import { Plugin, Notice, requestUrl } from "obsidian";

interface VNMMetadata {
  folder: string; // The folder name as realized
  more_info: string; // Link to learn about this folder
  version: string; // Latest version in MAJOR.MINOR.PATCH format
  requires: Record<string, string>; // Mapping of other folder to version
  zip: string; // URL of the zip containing the folder's contents
}

interface VNPluginData {
  knownFolders: Record<string, VNMMetadata>; // Mapping of folder name to VNM metadata
  lastUpdatedMetadata: number; // timestamp of last update
}

const DEFAULT_DATA: VNPluginData = {
  knownFolders: {},
  lastUpdatedMetadata: 0,
};

export default class VinayaNotebookPlugin extends Plugin {
  data: VNPluginData;

  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    const daysSinceLastUpdate = (Date.now() - this.data.lastUpdatedMetadata) / (1000 * 60 * 60 * 24);

    if (!this.data.knownFolders["Ajahn Brahmali"] || daysSinceLastUpdate > 7) {
      new Notice("Fetching Ajahn Brahmali metadata...");
      const response = await requestUrl("https://github.com/obu-labs/brahmali-vinaya-notes/releases/latest/download/brahmali.vnm");
      const metadata: VNMMetadata = response.json;
      this.data.knownFolders["Ajahn Brahmali"] = metadata;
      this.data.lastUpdatedMetadata = Date.now();
      await this.saveData(this.data);
      new Notice("Ajahn Brahmali folder metadata received!");
    } else {
      new Notice("Was able to restore previously saved data!");
    }
  }
}
