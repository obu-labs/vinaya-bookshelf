import { Notice, requestUrl } from "obsidian";
import VinayaNotebookPlugin from "./main";
import { hashForFolder } from "./hashutils";
import { downloadZip } from "./fileutils";

export interface VNMMetadata {
  folder: string; // The folder name as realized
  more_info: string; // Link to learn about this folder
  version: string; // Latest version in MAJOR.MINOR.PATCH format
  requires: Record<string, string>; // Mapping of other folder to version
  zip: string; // URL of the zip containing the folder's contents
}

export interface InstalledFolderRecord {
  version: string;
  hash: string;
}

class BaseDatumUpdater {
  plugin: VinayaNotebookPlugin;
  constructor(plugin: VinayaNotebookPlugin) {
    this.plugin = plugin;
  }

  get_id(): string {
    return "";
  }

  data_is_incomplete(): boolean {
    return false;
  }

  async perform_update(): Promise<boolean> {
    // returns true iff data written successfully
    return false;
  }

  check_how_often(): number { // in Days
    return 7;
  }

  get_last_updated_time(): number {
    const data = this.plugin.data.lastUpdatedTimes[this.get_id()];
    if (!data) {
      return 0;
    }
    return data;
  }

  get_days_since_last_updated(): number {
    return (Date.now() - this.get_last_updated_time()) / (1000 * 60 * 60 * 24);
  }

  is_expired(): boolean {
    return this.get_days_since_last_updated() > this.check_how_often();
  }

  needs_update(): boolean {
    return this.is_expired() || this.data_is_incomplete();
  }

  async update() {
    const success = await this.perform_update();
    if (success) {
      await this.register_update();
    } else {
      new Notice(`Error updating ${this.get_id()}`);
    }
  }

  async register_update() {
    this.plugin.data.lastUpdatedTimes[this.get_id()] = Date.now();
    await this.plugin.save();
  }
}

export class VNMListUpdater extends BaseDatumUpdater {
  get_id(): string {
    return "VNMList";
  }

  data_is_incomplete(): boolean {
    return Object.keys(this.plugin.data.canonicalVNMs).length === 0;
  }

  async perform_update() {
    // Stub for now.  In the future, really fetch this list
    this.plugin.data.canonicalVNMs["Ajahn Brahmali"] = "https://github.com/obu-labs/brahmali-vinaya-notes/releases/latest/download/brahmali.vnm";
    return true;
  }
}

export class VNMUpdater extends BaseDatumUpdater {
  folder_name: string;
  constructor(plugin: VinayaNotebookPlugin, folder_name: string) {
    super(plugin);
    this.folder_name = folder_name;
  }
  
  get_id(): string {
    return (this.folder_name + " VNM");
  }

  data_is_incomplete(): boolean {
    return !this.plugin.data.knownFolders[this.folder_name];
  }

  async perform_update(): Promise<boolean> {
    const vnm_url = this.plugin.data.canonicalVNMs[this.folder_name];
    try {
      const response = await requestUrl(vnm_url);
      const metadata: VNMMetadata = response.json;
      this.plugin.data.knownFolders[this.folder_name] = metadata;
    } catch (e) {
      console.error(e);
      return false;
    }
    return true;
  }
}

export class FolderUpdater extends BaseDatumUpdater {
  folder_name: string;
  constructor(plugin: VinayaNotebookPlugin, folder_name: string) {
    super(plugin);
    this.folder_name = folder_name;
  }

  check_how_often(): number {
    return 1; // We already know we're on the old version
  }

  get_id(): string {
    return (this.folder_name + " Folder");
  }

  is_installed(): boolean {
    return !!this.plugin.data.installedFolders[this.folder_name];
  }

  is_at_latest_version(): boolean {
    return this.plugin.data.installedFolders[this.folder_name].version === this.plugin.data.knownFolders[this.folder_name].version;
  }

  data_is_incomplete(): boolean {
    return !this.is_installed() || !this.is_at_latest_version();
  }

  needs_update(): boolean {
    // slightly different logic here because
    // the expiry is a retry timeout not a frequency
    return this.data_is_incomplete() && this.is_expired();
  }

  async perform_update(): Promise<boolean> {
    // We return true here even if it fails
    // because we always want to record the time of our attempt
    const folder = this.plugin.app.vault.getFolderByPath(this.folder_name);
    if (folder) {
      let needs_warning = true;
      if (this.is_installed()) {
        const old_hash = this.plugin.data.installedFolders[this.folder_name].hash;
        const cur_hash = await hashForFolder(folder);
        if (cur_hash === old_hash) {
          needs_warning = false;
        }
      }
      if (needs_warning) {
        // TODO replace this notice with a real modal dialog
        new Notice("!! REFUSING TO OVERWRITE CHANGED DATA !!");
        return true;
      }
    }
    const vnm_data = this.plugin.data.knownFolders[this.folder_name];
    try {
      const hash = await downloadZip(
        vnm_data.zip,
        this.folder_name,
        this.plugin.app,
      );
      this.plugin.data.installedFolders[this.folder_name] = {
        version: vnm_data.version,
        hash: hash
      };
      new Notice(`"${this.folder_name}" v${vnm_data.version} installed!`);
    } catch (e) {
      console.error(e);
    }
    return true;
  }
}
