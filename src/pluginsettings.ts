import { Notice, PluginSettingTab, Setting } from "obsidian";
import VinayaNotebookPlugin from "./main";
import { FolderName, FolderUpdater } from "./update";
import * as dayjs from "dayjs";
import * as relativeTime from "dayjs/plugin/relativeTime";
import { isUrl } from "./helpers";
import tippy from 'tippy.js';

dayjs.extend((relativeTime as any).default || relativeTime);

export class VinayaNotebookSettingsTab extends PluginSettingTab {
  plugin: VinayaNotebookPlugin;
  is_updating: boolean;
  is_foregrounded: boolean;
  custom_url_input: HTMLInputElement;
  custom_url_button: HTMLButtonElement;

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
        const updater = new FolderUpdater(this.plugin, name);
        const setting = new Setting(moduleEl)
          .setName(name)
          .addToggle((toggle) => {
            toggle
              .setValue(updater.subscribed())
              .onChange((value) => {
                if (value) {
                  updater.subscribe();
                } else {
                  updater.unsubscribe();
                }
              });
          });
        const descEl = setting.descEl.createDiv({ cls: "module-settings-desc" });
        const metaEl = descEl.createEl("p", { text: `Version: ${vnmdata.version}` });
        if (this.plugin.data.installedFolders[name] && vnmdata.version !== this.plugin.data.installedFolders[name].version) {
          metaEl.createSpan({ text: ` (Installed: ${this.plugin.data.installedFolders[name].version})` });
        }
        if (vnmdata.more_info.startsWith("http")) {
          metaEl.createSpan({ text: " • " });
          metaEl.createEl("a", { text: "Source", href: vnmdata.more_info });
        }
        descEl.createEl("p", { text: vnmdata.description });
      });
    const addModuleEl = feedSection.createDiv({ cls: "module-settings" });
    const setting = new Setting(addModuleEl)
      .setName("Add Module")
      .setDesc("Add a new module by URL.")
      .addText((text) => {
        text
          .setPlaceholder("https://example.com/manifest.vnm")
          .onChange((value) => {
            if (isUrl(value)) {
              this.custom_url_button.setText("+");
              this.custom_url_button.disabled = false;
              this.custom_url_input.style.color = "var(--text-normal)";
            } else {
              this.custom_url_button.disabled = true;
              this.custom_url_input.style.color = "var(--text-warning)";
            }
          });
        this.custom_url_input = text.inputEl;
      })
      .addButton((btn) => {
        btn
          .setButtonText('+')
          .onClick(async () => {
            this.custom_url_button.disabled = true;
            this.custom_url_button.setText("");
            this.custom_url_button.addClass("loading-spinner");
            await sleep(200);
            console.log(this.custom_url_input.value);
            this.custom_url_input.style.color = "var(--text-error)";
            this.custom_url_button.removeClass("loading-spinner");
            this.custom_url_button.setText("❌");
            const tip = tippy(this.custom_url_input, {
              content: "Invalid URL",
              placement: "top",
              trigger: "manual",
              animation: "scale-subtle",
              hideOnClick: true,
              theme: 'error',
            });
            tip.show();
            setTimeout(() => {
              tip?.destroy();
            }, 2500);
          });
        this.custom_url_button = btn.buttonEl;
      });
  }
}