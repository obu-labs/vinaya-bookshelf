import { Notice, requestUrl, Platform } from "obsidian";
import VinayaNotebookPlugin from "./main";
import { hashForFolder } from "./hashutils";
import downloadZip from "./downloadZip";
import confirmationModal from "./confirmationmodal";
import { statsForFolder } from "./fileutils";

const CANONICAL_VNM_LIST_URL = "https://labs.buddhistuniversity.net/vinaya/canonicalvnms.json";

export type FolderName = string;
export type URLString = string;

export interface VNMMetadata {
  folder: FolderName; // The folder name as realized
  more_info: string; // Link to learn about this folder
  description?: string; // Description of the folder TODO make not optional?
  version: string; // Latest version in MAJOR.MINOR.PATCH format
  requires: Record<string, Record<string, any>>; // Mapping of other folder to its subfolders (recursive)
  zip: URLString; // URL of the zip containing the folder's contents
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

  /**
   * The logic for actually doing the update.
   * 
   * @returns true if it would like to save the plugin's data
   */
  async perform_update(): Promise<boolean> {
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
    try {
      const response = await requestUrl(CANONICAL_VNM_LIST_URL);
      const vnm_list: Record<FolderName, URLString> = response.json;
      this.plugin.data.canonicalVNMs = vnm_list;
      return true;
    } catch (e) {
      console.error(e);
    }
    return false;
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
  warn_about_overwrites: boolean;
  constructor(plugin: VinayaNotebookPlugin, folder_name: string) {
    super(plugin);
    this.folder_name = folder_name;
    this.warn_about_overwrites = true;
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

  is_expired(): boolean {
    if (this.warn_about_overwrites) {
      return super.is_expired();
    }
    return true; // If we aren't warning, consider their dismissal expired
  }

  async subscribe() {
    this.plugin.data.folderOptOuts.remove(this.folder_name);
    await this.plugin.save();
  }

  async unsubscribe() {
    this.plugin.data.folderOptOuts.push(this.folder_name);
    await this.plugin.save();
  }

  subscribed(): boolean {
    return !this.plugin.data.folderOptOuts.contains(this.folder_name);
  }

  needs_update(): boolean {
    // slightly different logic here because
    // the expiry is a retry timeout not a frequency
    return this.data_is_incomplete() && this.is_expired() && this.subscribed();
  }

  async perform_update(): Promise<boolean> {
    // We return true here even if it fails
    // because we always want to record the time of our attempt
    const folder = this.plugin.app.vault.getFolderByPath(this.folder_name);
    if (this.warn_about_overwrites && folder) {
      let needs_warning = true;
      if (this.is_installed()) {
        const stats = statsForFolder(folder);
        if (Platform.isDesktop || stats.length < 600) { // small folder, check the hash
          const old_hash = this.plugin.data.installedFolders[this.folder_name].hash;
          const cur_hash = await hashForFolder(folder);
          if (cur_hash === old_hash) {
            needs_warning = false;
          }
        } else { // large folder on mobile, just check the stat.mtime
          const updatedtime = this.get_last_updated_time();
          const modifiedtime = Math.max(...stats.map(stat => stat.mtime));
          if (updatedtime + 3000 > modifiedtime) { // a little wiggle room for delayed writes
            needs_warning = false;
          }
        }
      }
      if (needs_warning) {
        const user_confirmed = await confirmationModal(
          `Update the "${this.folder_name}" folder?`,
          `The "${this.folder_name}" folder has a new version available, but the version you currently have has been modified. If you proceed to install the new version, those changes will be lost.`,
          this.plugin.app,
          "Overwite Changes",
          "Ask me again tomorrow",
        )
        if (!user_confirmed) {
          return true; // save the timestamp of this refusal
        }
      }
    }

    const original_notice = new Notice(`Installing new "${this.folder_name}" folder...`, 0);
    const vnm_data = this.plugin.data.knownFolders[this.folder_name];
    try {
      const hash = await downloadZip(
        vnm_data.zip,
        this.folder_name,
        this.plugin.app,
        original_notice
      );
      this.plugin.data.installedFolders[this.folder_name] = {
        version: vnm_data.version,
        hash: hash
      };
      new Notice(`"${this.folder_name}" v${vnm_data.version} successfully installed!`);
    } catch (e) {
      console.error(e);
      new Notice(`!! Failed to install "${this.folder_name}"!`, 10000);
    }
    return true;
  }
}
