import { Notice, requestUrl, Platform, normalizePath } from "obsidian";
import VinayaNotebookPlugin from "./main";
import { hashForFolder } from "./hashutils";
import downloadZip from "./downloadZip";
import confirmationModal from "./confirmationmodal";
import { statsForFolder } from "./fileutils";

const CANONICAL_VNM_LIST_URL = "https://labs.buddhistuniversity.net/vinaya/canonicalvnms.json";

export type FolderName = string;
export type URLString = string;

const VNMMetadataShape = {
  folder: 'string', // The folder name as realized
  more_info: 'string', // Link to learn about this folder
  description: 'string', // Description of the folder
  version: 'string', // Latest version in MAJOR.MINOR.PATCH format
  requires: 'object', // Mapping of other folder to its subfolders (recursive)
  zip: 'string', // URL of the zip containing the folder's contents
} as const;

export type VNMMetadata = {
  [K in keyof typeof VNMMetadataShape]:
    typeof VNMMetadataShape[K] extends 'string' ? string :
    typeof VNMMetadataShape[K] extends 'object' ? Record<string, Record<string, any>> :
    never
};

function assert(truth: any, message?: string): void {
  if (!truth) {
    throw new Error("Assertion failed" + (message ? ": " + message : ""));
  }
}

/**
 * 
 * @param url The URL of the VNM manifest file to download
 * @throw Error if the URL is bad or returns data in the wrong form
 * @returns The VNM metadata
 */
export async function fetch_vnm(url: string): Promise<VNMMetadata> {
  const response = await requestUrl(url);
  const metadata: any = response.json;
  assert(typeof metadata === "object", "VNMs are JSON objects");
  for (const [key, value] of Object.entries(VNMMetadataShape)) {
    assert(typeof metadata[key] === value, `${key} must be a(n) ${value}`);
  }
  return metadata;
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
      const metadata: VNMMetadata = await fetch_vnm(vnm_url);
      this.plugin.data.knownFolders[this.folder_name] = metadata;
    } catch (e) {
      console.error(e);
      return false;
    }
    // In case the user is looking at the version info in the settings tab
    this.plugin.settingsTab.refreshDisplay();
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
    await this.perform_update();
    await this.plugin.save();
  }

  async unsubscribe(silently?: boolean) {
    if (!this.plugin.data.folderOptOuts.contains(this.folder_name)) {
      this.plugin.data.folderOptOuts.push(this.folder_name);
      await this.plugin.save();
    }

    const folder = this.plugin.app.vault.getFolderByPath(normalizePath(this.folder_name));
    if (folder && !silently) {
      const user_wants_it_gone = await confirmationModal(
        "You are unsubscribed!",
        "Vinaya Notebook will no longer download updates for this module. Would you also like to delete the folder?",
        this.plugin.app,
        `Delete the "${folder.name}" folder now`,
        "Keep the folder",
      );
      if (user_wants_it_gone) {
        await this.plugin.app.fileManager.trashFile(folder);
        if (this.is_installed()) {
          delete this.plugin.data.installedFolders[this.folder_name];
          await this.plugin.save();
        }
        new Notice(`The "${folder.name}" folder has been trashed.`);
      } else {
        new Notice(`Will keep "${folder.name}" but will no longer keep it up-to-date.`);
      }
    } else {
      // The folder doesn't exist, but still double check that
      // we've cleared the installation metadata.
      // This can happen if the user deleted the folder manually in the OS.
      if (this.is_installed()) {
        delete this.plugin.data.installedFolders[this.folder_name];
        await this.plugin.save();
      }
      if (!silently) {
        new Notice(`Unsubscribed from "${this.folder_name}".`);
      }
    }
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
          `The "${this.folder_name}" folder has a new version available, but the version you currently have may have been modified. If you install the new version, any changes you've made will be lost.`,
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
