// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-
// Start apps on custom workspaces
/* exported init buildPrefsWidget */

const {Adw, Gio, GLib, GObject, Gtk} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

const _ = ExtensionUtils.gettext;

const SETTINGS_KEY = 'application-list';

const WORKSPACE_MAX = 36; // compiled in limit of mutter

class NewItem extends GObject.Object {}
GObject.registerClass(NewItem);

class NewItemModel extends GObject.Object {
    static [GObject.interfaces] = [Gio.ListModel];
    static {
        GObject.registerClass(this);
    }

    #item = new NewItem();

    vfunc_get_item_type() {
        return NewItem;
    }

    vfunc_get_n_items() {
        return 1;
    }

    vfunc_get_item(_pos) {
        return this.#item;
    }
}

class Rule extends GObject.Object {
    static [GObject.properties] = {
        'app-info': GObject.ParamSpec.object(
            'app-info', 'app-info', 'app-info',
            GObject.ParamFlags.READWRITE,
            Gio.DesktopAppInfo),
    };

    static {
        GObject.registerClass(this);
    }
}

class RulesList extends GObject.Object {
    static [GObject.interfaces] = [Gio.ListModel];
    static {
        GObject.registerClass(this);
    }

    #settings = ExtensionUtils.getSettings();
    #rules = [];
    #changedId;

    constructor() {
        super();

        this.#changedId =
            this.#settings.connect(`changed::${SETTINGS_KEY}`,
                () => this.#sync());
        this.#sync();
    }

    append(appInfo) {
        const pos = this.#rules.length;

        this.#rules.push(new Rule({appInfo}));
        this.#saveRules();

        this.items_changed(pos, 0, 1);
    }

    remove(id) {
        const pos = this.#rules.findIndex(r => r.appInfo.get_id() === id);
        if (pos < 0)
            return;

        this.#rules.splice(pos, 1);
        this.#saveRules();

        this.items_changed(pos, 1, 0);
    }

    #saveRules() {
        this.#settings.block_signal_handler(this.#changedId);
        this.#settings.set_strv(SETTINGS_KEY,
            this.#rules.map(r => r.app_info.get_id()));
        this.#settings.unblock_signal_handler(this.#changedId);
    }

    #sync() {
        const removed = this.#rules.length;

        this.#rules = [];
        for (const id of this.#settings.get_strv(SETTINGS_KEY)) {
            const appInfo = Gio.DesktopAppInfo.new(id);
            if (appInfo)
                this.#rules.push(new Rule({appInfo}));
            else
                log(`Invalid ID ${id}`);
        }
        this.items_changed(0, removed, this.#rules.length);
    }

    vfunc_get_item_type() {
        return Rule;
    }

    vfunc_get_n_items() {
        return this.#rules.length;
    }

    vfunc_get_item(pos) {
        return this.#rules[pos] ?? null;
    }
}

class AutoMoveSettingsWidget extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);

        this.install_action('rules.add', null, self => self._addNewRule());
        this.install_action('rules.remove', 's',
            (self, name, param) => self._rules.remove(param.unpack()));
    }

    constructor() {
        super({
            title: _('Win + Tab switch applications'),
        });

        this._rules = new RulesList();

        const store = new Gio.ListStore({item_type: Gio.ListModel});
        const listModel = new Gtk.FlattenListModel({model: store});
        store.append(this._rules);
        store.append(new NewItemModel());

        this._list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        this.add(this._list);

        this._list.bind_model(listModel, item => {
            return item instanceof NewItem
                ? new NewRuleRow()
                : new RuleRow(item);
        });
    }

    _addNewRule() {
        const dialog = new NewRuleDialog(this.get_root());
        dialog.connect('response', (dlg, id) => {
            const appInfo = id === Gtk.ResponseType.OK
                ? dialog.get_widget().get_app_info() : null;
            if (appInfo)
                this._rules.append(appInfo);
            dialog.destroy();
        });
        dialog.show();
    }
}

class RuleRow extends Adw.ActionRow {
    static {
        GObject.registerClass(this);
    }

    constructor(rule) {
        const {appInfo} = rule;
        const id = appInfo.get_id();

        super({
            activatable: false,
            title: rule.appInfo.get_display_name(),
        });

        const icon = new Gtk.Image({
            css_classes: ['icon-dropshadow'],
            gicon: appInfo.get_icon(),
            pixel_size: 32,
        });
        this.add_prefix(icon);

        const button = new Gtk.Button({
            action_name: 'rules.remove',
            action_target: new GLib.Variant('s', id),
            icon_name: 'edit-delete-symbolic',
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });
        this.add_suffix(button);
    }
}

class NewRuleRow extends Gtk.ListBoxRow {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            action_name: 'rules.add',
            child: new Gtk.Image({
                icon_name: 'list-add-symbolic',
                pixel_size: 16,
                margin_top: 12,
                margin_bottom: 12,
                margin_start: 12,
                margin_end: 12,
            }),
        });
        this.update_property(
            [Gtk.AccessibleProperty.LABEL], [_('Add Rule')]);
    }
}

class NewRuleDialog extends Gtk.AppChooserDialog {
    static {
        GObject.registerClass(this);
    }

    constructor(parent) {
        super({
            transient_for: parent,
            modal: true,
        });

        this._settings = ExtensionUtils.getSettings();

        this.get_widget().set({
            show_all: true,
            show_other: true, // hide more button
        });

        this.get_widget().connect('application-selected',
            this._updateSensitivity.bind(this));
        this._updateSensitivity();
    }

    _updateSensitivity() {
        const rules = this._settings.get_strv(SETTINGS_KEY);
        const appInfo = this.get_widget().get_app_info();
        this.set_response_sensitive(Gtk.ResponseType.OK,
            appInfo && !rules.some(i => i.startsWith(appInfo.get_id())));
    }
}

/** */
function init() {
    ExtensionUtils.initTranslations();
}

/**
 * @returns {Gtk.Widget} - the prefs widget
 */
function buildPrefsWidget() {
    return new Gtk.Label({
        label: "Window Switcher",
    });
}
/**
 * This function is called when the preferences window is first created to fill
 * the `Adw.PreferencesWindow`.
 *
 * If this function is defined, `buildPrefsWidget()` will NOT be called.
 *
 * @param {Adw.PreferencesWindow} window - The preferences window
 */
function fillPreferencesWindow(window) {
    // Create a preferences page, with a single group
    const page = new Adw.PreferencesPage({});
    window.add(page);

    const group = new Adw.PreferencesGroup({
        title: _('Behavior'),
    });
    page.add(group);

    // Create a new preferences row
    const workspaceSwitch = new Gtk.Switch({});
    workspaceSwitch.set_valign(Gtk.Align.CENTER);
    const workspaceRow = new Adw.ActionRow({
        title: _('Show windows of all workspace'),
    });
    workspaceRow.add_suffix(workspaceSwitch);
    group.add(workspaceRow);

    const minimizedSwitch = new Gtk.Switch({});
    minimizedSwitch.set_valign(Gtk.Align.CENTER);
    const minimizedRow = new Adw.ActionRow({
        title: _('Show minimized windows'),
    });
    minimizedRow.add_suffix(minimizedSwitch);
    group.add(minimizedRow);

    page.add(new AutoMoveSettingsWidget());

    // Create a settings object and bind the row to the `show-indicator` key
    window._settings = ExtensionUtils.getSettings();
    window._settings.bind('all-desktops', workspaceSwitch, 'active',
        Gio.SettingsBindFlags.DEFAULT);
    window._settings.bind('show-minimized', minimizedSwitch, 'active',
        Gio.SettingsBindFlags.DEFAULT);
}
