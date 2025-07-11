import { Notice, PluginSettingTab, Setting } from "obsidian";
import VinayaNotebookPlugin from "./main";
import { FolderName } from "./update";
import * as dayjs from "dayjs";
import * as relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend((relativeTime as any).default || relativeTime);

export class VinayaNotebookSettingsTab extends PluginSettingTab {
  plugin: VinayaNotebookPlugin;
  is_updating: boolean;
  is_foregrounded: boolean;

  constructor(plugin: VinayaNotebookPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
    this.is_updating = false;
    this.is_foregrounded = false;
  }

  setIsUpdating(is_updating: boolean) {
    this.is_updating = is_updating;
    this.refreshDisplay();
  }

  hide(): void {
    this.is_foregrounded = false;
    super.hide();
  }

  refreshDisplay(): void {
    if (this.is_foregrounded) {
      this.display();
    }
  }

  display(): void {
    this.is_foregrounded = true;
    let { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Force Update')
      .setDesc(createFragment(
        (fragment) => {
          if (this.is_updating) {
            const text = document.createElement('span');
            text.setText('Updating now...');
            fragment.append(text);
          } else {
            const text1 = document.createElement('span');
            text1.setText('Last updated ');
            fragment.append(text1);
            const text2 = document.createElement('span');
            const lastTime = this.plugin.last_updated_time();
            if (lastTime === Infinity) {
              text2.setText('Never');
              fragment.append(text2);
            } else {
              const relativeTime = dayjs.unix(lastTime/1000).fromNow();
              text2.setText(relativeTime);
              fragment.append(text2);
            }
          }
        }
      ))
      .addButton((btn) => {
        if (this.is_updating) {
          btn.setDisabled(true);
          btn.setClass('loading-spinner');
        } else {
          btn.setButtonText('Update Now');
          btn.onClick(() => {
            this.plugin.force_update();
          });
        }
      });
    
    new Setting(containerEl).setHeading().setName("Module Subscriptions")
      .setDesc("Toggle any module off to stop receiving updates for it.");
    
    const feedSection = containerEl.createDiv({ cls: "module-settings-section" });    
    // feedSection.createEl("h3", { text: "Manage Module Subscriptions" });
    Object.entries(this.plugin.data.knownFolders)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([name, vnmdata]) => {
        const moduleEl = feedSection.createDiv({ cls: "module-settings" });
        const setting = new Setting(moduleEl)
          .setName(name)
          .addToggle((toggle) => {
            toggle
              .setValue(!this.plugin.data.folderOptOuts.contains(name))
              .onChange((value) => {
                if (value) {
                  this.plugin.data.folderOptOuts.remove(name);
                } else {
                  this.plugin.data.folderOptOuts.push(name);
                }
                this.plugin.save();
              });
          });
        const descEl = setting.descEl.createDiv({ cls: "module-settings-desc" });
        const metaEl = descEl.createEl("p", { text: `Version: ${vnmdata.version} • ` });
        if (vnmdata.more_info.startsWith("http")) {
          metaEl.createEl("a", { text: "Source", href: vnmdata.more_info });
        }
        descEl.createEl("p", { text: vnmdata.description });
      });
  }
}