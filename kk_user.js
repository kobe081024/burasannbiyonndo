// ==UserScript==

let options = {};
let target_tab_id = null;

async function init_session() {
    let tabs = await browser.tabs.query({});
    for (let tab of tabs) {
	let val = await browser.sessions.getTabValue(tab.id, "destination");
	if (val) {
	    target_tab_id = tab.id;
	    browser.tabs.onRemoved.addListener(onRemoved);
	    break;
	}
    }
}

let content_scripts;
let css;
async function init(changes, areaname) {
    options = await browser.storage.local.get();
    delete(options.audio);
    options.num_iterations = parseInt(options.num_iterations);
    update_menus();

    if (content_scripts) {
	content_scripts.unregister();
    }
    if (options.procedure_files) {
	browser.contentScripts.register({
	    "js": [{file: "content.js"}],
	    "matches": [options.procedure_files]
	}).then(response => {
	    content_scripts = response;
	}).catch(error => {
	    console.log(error.message);
	});
    }

    if (options.hide_contents) {
	set_hide_contents();
    } else if (options.hide_images) {
	set_hide_images();
    } else {
	set_display_contents();
    }
}
init_session();
init();
browser.storage.onChanged.addListener(init);

browser.runtime.onStartup.addListener(() => {
    setTimeout(() => {
	if (options.run_at_browser_start) {
	    execute();
	}
    }, 4000);
});

let npages = 0;
let page = 0;
let loop_counter = 0;
let num_iterations = 1;
let lines;
let line_ptr = 0;
let running = "stop";
async function execute(procedure) {
    if (running == "stop") {
	await execute_init(procedure || options.procedure);
	running = "running";
	page = npages;
	loop();
	return;
    } else if (running == "running") {
	running = "pause";
	execute_end("pause");
	return;
    } else if (running == "pause") {
	browser.browserAction.setBadgeBackgroundColor({color: null});
	running = "running";
	loop();
	return;
    }
}

async function execute_init(procedure) {
    lines = parser(procedure);
    line_ptr = 0;
    npages = 0;
    for (let line of lines) {
	if (!executor[line.cmd]) {
	    line.args[0] = line.cmd;
	    line.cmd = "open";
	}
	if (["open", "reload"].includes(line.cmd)) {
	    npages++;
	}
    }
    if (options.default_sleep_time != "0") {
	let index = lines.findIndex(a => a.cmd == "open");
	index = index > 0 ? index : 0;
	for (let i = lines.length - 1; i > index; i--) {
	    if (["open", "reload"].includes(lines[i].cmd)) {
		lines.splice(i, 0, {cmd: "sleep", args: [options.default_sleep_time]});
	    }
	}
    }
    loop_counter = 0;
    num_iterations = options.num_iterations || 1;
    await get_target_tab(true);
    set_updated_listener();
    if (options.hide_tab) {
	return executor.hide();
    }
}

async function loop() {
    while (loop_counter < num_iterations) {
	if (page == 0) {
	    page = npages;
	}
	if (line_ptr == lines.length) {
	    line_ptr = 0;
	}
	for (; line_ptr < lines.length; line_ptr++) {
	    if (running !== "running") {
		return;
	    }
	    if (["notify", "window_title", "container"].includes(lines[line_ptr].cmd)) {
		await executor[lines[line_ptr].cmd].call(executor, lines[line_ptr].text);
	    } else {
		await executor[lines[line_ptr].cmd].apply(executor, lines[line_ptr].args);
	    }
	}
	if (options.num_iterations) {
	    loop_counter++;
	}
	if (loop_counter < num_iterations) {
	    if (options.notify_every_loop_end) {
		notify(`${browser.i18n.getMessage("task_went_around")}\n${loop_counter} / ${options.num_iterations}`);
	    }
	    await executor.sleep(options.sleep_time_between_loop);
	}
    }
    execute_end("end");
}

let timer_resolve;
let timer;
function execute_end(flag = "end") {
    if (timer_resolve) {
	clearTimeout(timer);
	timer_resolve();
	timer_resolve = null;
    }
    if (flag == "end" && options.remove_tab && target_tab_id) {
	browser.tabs.onRemoved.removeListener(onRemoved);
	setTimeout(() => {
	    browser.tabs.remove(target_tab_id).then(() => {
		target_tab_id = null;
	    });
	}, 1000);
    }
    if (flag == "end") {
	if (options.notify_when_complete) {
	    notify(browser.i18n.getMessage("task_complete"));
	}
	if (options.play_audio_when_complete) {
	    browser.storage.local.get("audio").then(item => {
		new Audio(item.audio).play();
	    });
	}
    }
    if (flag == "pause") {
	browser.browserAction.setBadgeBackgroundColor({color: "gold"});
    } else {
	browser.browserAction.setBadgeBackgroundColor({color: null});
	browser.tabs.onUpdated.removeListener(onUpdated);
	browser.browserAction.setBadgeText({text: ""});
	browser.browserAction.setTitle({title: browser.i18n.getMessage("extension_name")});
	browser.browserAction.setIcon({path: "lib/list.svg"});
	running = "stop";
	executor.window_title("");
    }
};

const executor = {};
executor.sleep = async function(time) {
    let a = time.split(":");
    a = a.map(n => parseInt(n));
    let t;
    switch (a.length) {
    case 1:
	t = a[0];
	break;
    case 2:
	t = a[0] * 60 + a[1];
	break;
    case 3:
	t = a[0] * 3600 + a[1] * 60 + a[2];
	break;
    }
    await new Promise(resolve => {
	timer_resolve = resolve;
	timer = setTimeout(resolve, t * 1000);
    });
};

executor.open = async function(url) {
    await browser.tabs.update(target_tab_id, {url});
    page--;
    if (options.show_badge_text_on_ba) {
	browser.browserAction.setBadgeText({text: page.toString()});
    }
    browser.browserAction.setTitle({title: url});
    await new Promise(resolve => {
	timer_resolve = resolve;
	timer = setTimeout(() => {
	    resolve();
	    timer_resolve = null;
	}, 60000);
    });
};

executor.reload = async function(arg) {
    if (arg == "bypass_cache") {
	await browser.tabs.reload(target_tab_id, {bypassCache: true});
    } else {
	await browser.tabs.reload(target_tab_id, {bypassCache: false});
    }
    page--;
    if (options.show_badge_text_on_ba) {
	browser.browserAction.setBadgeText({text: page.toString()});
    }
    await new Promise(resolve => {
	timer_resolve = resolve;
	timer = setTimeout(() => {
	    resolve();
	    timer_resolve = null;
	}, 60000);
    });
};

let favicon_timer;
function onUpdated(tabId, changeInfo, tabInfo) {
    if (changeInfo.status == "complete") {
	if (timer_resolve) {
	    clearTimeout(timer);
	    timer_resolve();
	    timer_resolve = null;
	} else {
	}
	browser.browserAction.setTitle({title: `${tabInfo.title}\n${tabInfo.url}`});
	if (options.show_favicon_on_ba) {
	    clearTimeout(favicon_timer);
	    favicon_timer = setTimeout(() => {
		browser.tabs.get(tabId).then(tab => {
		    if (!tab.favIconUrl) {
			browser.browserAction.setIcon({path: "lib/list.svg"});
		    }
		});
	    }, 500);
	}
	if (options.delete_history) {
	    browser.history.deleteUrl({url: tabInfo.url});
	}
    } else if (css && changeInfo.status == "loading") {
	browser.tabs.insertCSS(tabId, {
	    code: css,
	    allFrames: true,
	    cssOrigin: "user",
	    runAt: "document_start",
	}).catch(error => {
	    console.log(error.message + "\n" + tabInfo.url);
	    return error.message;
	});
    } else if (changeInfo.favIconUrl) {
	browser.browserAction.setIcon({path: tabInfo.favIconUrl});
    }
}

function set_updated_listener() {
    browser.tabs.onUpdated.removeListener(onUpdated);
    let prop = options.show_favicon_on_ba ?
	["status", "favIconUrl"] : ["status"];
    browser.tabs.onUpdated.addListener(
	onUpdated, {tabId: target_tab_id, properties: prop});
}

function onRemoved(tabId, removeInfo) {
    if (tabId == target_tab_id) {
	browser.tabs.onRemoved.removeListener(onRemoved);
	browser.tabs.onUpdated.removeListener(onUpdated);
	target_tab_id = null;
	execute_end("abort");
    }
}

executor.hide = function() {
    return hide_tab(target_tab_id);
};

async function hide_tab(tab_id) {
    let tab = await get_target_tab();
    if (!tab) {
	return null;
    }
    if (tab.active) {
	let index;
	let tabs = await browser.tabs.query({windowId: tab.windowId, hidden: false, discarded: false});
	let activate_tab;
	if (tab.index == 0) {
	    activate_tab = tabs.sort((a, b) => a.index > b.index)
		.find(({index}) => index > tab.index);
	} else {
	    activate_tab = tabs.sort((a, b) => a.index < b.index)
		.find(({index}) => index < tab.index);
	}
	await browser.tabs.update(activate_tab.id, {active: true});
    }
    return browser.tabs.hide(tab.id);
}

executor.show = async function() {
    await browser.tabs.show(target_tab_id);
};

executor.active = async function(option) {
    let target = await get_target_tab();
    if (option == "no_audible") {
	let [active] = await browser.tabs.query({windowId: target.windowId, active: true});
	if (active.audible || !active.audible && active.mutedInfo.muted) {
	    return null;
	}
    }
    return browser.tabs.update(target_tab_id, {active: true});
};

executor.move_to_active = async function(side) {
    move_to_active(target_tab_id, side);
};

async function move_to_active(tab_id, side) {
    let target = await get_target_tab();
    if (!target) {
	return null;
    }
    let current_window = await browser.windows.getCurrent();
    let index;
    let [active] = await browser.tabs.query({windowId: browser.windows.WINDOW_ID_CURRENT, active: true});
    if (active.pinned) {
	let tabs = await browser.tabs.query({windowId: active.windowId, pinned: false, hidden: false});
	if (tabs.length) {
	    tabs = tabs.sort((a, b) => a.index > b.index);
	    index = tabs[0].index;
	} else {
	    index = -1;
	}
    } else if (target.windowId == current_window) {
	if (side == "left") {
	    index = target.index < active.index ?
		active.index - 1 : active.index;
	} else {
	    index = target.index < active.index ?
		active.index : active.index + 1;
	}
    } else {
	if (side == "left") {
	    index = active.index;
	} else {
	    index = active.index + 1;
	}
    }
    await browser.tabs.move(tab_id, {windowId: browser.windows.WINDOW_ID_CURRENT, index});
    if (target.windowId != current_window) {
	browser.sessions.setTabValue(target_tab_id, "destination", true);
    }
    return browser.tabs.show(tab_id);
}

executor.notify = async function(text) {
    browser.tabs.get(target_tab_id).then(tab => {
	text = text.replace(/{title}/g, tab.title).replace(/{url}/g, tab.url);
	notify(text, tab.favIconUrl);
    });
};

executor.hide_contents = async function(side) {
    set_hide_contents();
};

function set_hide_contents() {
    css = `
* {
    display: none !important;
}
* {
    background-image: none !important;
}
`;
}

executor.hide_images = async function(side) {
    set_hide_images();
};

function set_hide_images() {
    css = `
img, canvas, video {
    visibility: hidden !important;
}
* {
    background-image: none !important;
}
`;
}

executor.display_contents = async function(side) {
    set_display_contents();
};

function set_display_contents() {
    css = null;
}

executor.window_state = function(state) {
    browser.windows.update(browser.windows.WINDOW_ID_CURRENT, {state: state});
};

let window_title_changed = false;
executor.window_title = async function(text) {
    if (text) {
	browser.windows.update(browser.windows.WINDOW_ID_CURRENT, {titlePreface : text});
	window_title_changed = true;
    } else if (window_title_changed) {
	browser.windows.update(browser.windows.WINDOW_ID_CURRENT, {titlePreface : text});
	window_title_changed = false;
    }
};

executor.container = async function(cname) {
    let target = await get_target_tab();
    if (target) {
	let cid = await browser.contextualIdentities.get(target.cookieStoreId).catch(e => {
	    return null;
	});
	if (cid && cid.name != cname || !cid && cname != "default") {
	    await create_target_tab(cname);
    	    await browser.tabs.remove(target.id);
	}
    } else {
	await create_target_tab(cname);
    }
};

function get_target_tab(create = false, container) {
    if (target_tab_id) {
	return browser.tabs.get(target_tab_id).then(tab => {
	    return tab;
	}).catch(e => {
	    if (create) {
		return create_target_tab(container);
	    } else {
		target_tab_id = null;
		return null;
	    }
	});
    } else {
	if (create) {
	    return create_target_tab(container);
	} else {
	    target_tab_id = null;
	    return null;
	}
    }
}

async function create_target_tab(container) {
    let prop = {url: "about:blank"};
    let cids = await browser.contextualIdentities.query({});
    let cid = cids.find(item => item.name == container);
    if (cid) {
	prop.cookieStoreId = cid.cookieStoreId;
    }
    let [active] = await browser.tabs.query({currentWindow: true, active: true});
    let tab = await browser.tabs.create(prop);
    target_tab_id = tab.id;
    browser.tabs.onRemoved.removeListener(onRemoved);
    browser.tabs.onRemoved.addListener(onRemoved);
    set_updated_listener();
    if (options.hide_tab) {
	await browser.tabs.update(active.id, {active: true});
	await browser.tabs.hide(target_tab_id);
    }
    browser.sessions.setTabValue(target_tab_id, "destination", true);
    return tab;
}

function parser(text) {
    if (/^\s*$/.test(text)) {
	return [];
    }
    return text.split(/\n/)
	.filter(line => /\S/.test(line))
	.map(line => {
	    let args = line.trim().split(/\s+/);
	    let cmd = args.shift();
	    let arg = line.replace(/^\s*[^\s]+\s?/, "");
	    return {cmd, args, text: arg};
	})
	.filter(line => !/^#/.test(line.cmd));
}

function unescape_slashes(str) {
    let str2 = str.replace(/(^|[^\\])(\\\\)*\\$/, "$&\\");
    try {
	str2 = JSON.parse(`"${str2}"`);
    } catch(e) {
	return str;
    }
    return str2;
}

async function check_procerure(source_text) {
    let ln = 0;
    let err = [];
    let texts = source_text.split("\n");
    let cids = await browser.contextualIdentities.query({});
    for (let text of texts) {
	ln++;
	if (/^\s*(#.*)?$/.test(text)) {
	    continue;
	}
	let a = text.trim().split(/\s+/);
	let line = {cmd: a.shift(), args: a};
	switch(line.cmd) {
	case "container":
	    if (line.args.length < 1) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_number_of_arguments")} ${text}`);
		continue;
	    }
	    let p = parser(text);
	    if (!cids.find(item => item.name == p[0].text) && p[0].text != "default") {
		err.push(`${ln}: ${browser.i18n.getMessage("invalid_container")} ${text}`);
		continue;
	    }
	    break;
	case "sleep":
	    if (line.args.length != 1) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_number_of_arguments")} ${text}`);
		continue;
	    }
	    if (!/^\d+(:\d+){0,2}$/.test(line.args[0])) {
		err.push(`${ln}: ${browser.i18n.getMessage("format_error")} ${text}`);
		continue;
	    }
	    break;
	case "open":
	    if (line.args.length != 1) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_number_of_arguments")} ${text}`);
	    }
	    break;
	case "reload":
	    if (line.args.length != 0 && line.args.length != 1) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_number_of_arguments")} ${text}`);
	    }
	    if (line.args.length == 1 && line.args[0] != "bypass_cache") {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_argument")} ${line.cmd} ${line.args[0]}`);
	    }
	    break;
	case "hide":
	case "show":
	case "active":
	case "hide_contents":
	case "hide_images":
	case "display_contents":
	    if (line.args.length > 1) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_number_of_arguments")} ${text}`);
	    }
	    if (line.args.length == 1 && line.args[0] != "no_audible") {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_argument")} ${line.cmd} ${line.args[0]}`);
	    }
	    break;
	case "move_to_active":
	    if (line.args.length > 1) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_number_of_arguments")} ${text}`);
	    }
	    if (line.args.length == 1 && !["left", "right"].includes(line.args[0])) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_argument")} ${line.cmd} ${line.args[0]}`);
	    }
	    break;
	case "notify":
	    if (line.args.length < 1) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_number_of_arguments")} ${text}`);
	    }
	    break;
	case "window_state":
	    if (line.args.length != 1) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_number_of_arguments")} ${text}`);
	    } else if (!["normal", "minimized", "maximized", "fullscreen", "docked"].includes(line.args[0])) {
		err.push(`${ln}: ${browser.i18n.getMessage("wrong_argument")} ${line.cmd} ${line.args[0]}`);	    }
	    break;
	case "window_title":
	    break;
	default:
	    if (line.args.length != 0
		|| !/:\/\//.test(line.cmd)
		|| /^(chrome|javascript|data|file):/.test(line.cmd)) {
		err.push(`${ln}: ${browser.i18n.getMessage("invalid_command")} ${line.cmd}`);
	    }
	    break;
	}
    }
    return err;
}

async function update_menus() {
    browser.menus.removeAll();
    if (!options.show_context_menu) {
	return;
    }
    let commands = await browser.commands.getAll();
    let sc = new Map();
    for (let elem of commands) {
        sc.set(elem.name, elem.shortcut);
    }
    let id, title, shortcut;

    id = "start_pause_processing";
    title = browser.i18n.getMessage(id);
    title += browser.i18n.getMessage("click");
    shortcut = sc.get(id);
    title = shortcut ? `${title} (${shortcut}) (&G)` : `${title} (&G)`;
    browser.menus.create({
	id: id,
	title: title,
	onclick: (info, tab) => {
	    execute();
	}
    });

    id = "end_processing";
    title = browser.i18n.getMessage(id);
    title += browser.i18n.getMessage("ctrl_click");
    shortcut = sc.get(id);
    title = shortcut ? `${title} (${shortcut}) (&E)` : `${title} (&E)`;
    browser.menus.create({
	id: id,
	title: title,
	onclick: (info, tab) => {
	    execute_end("abort");
	}
    });

    id = "duplicate_tab";
    title = browser.i18n.getMessage(id);
    title += browser.i18n.getMessage("ctrl_middle_click");
    shortcut = sc.get(id);
    title = shortcut ? `${title} (${shortcut}) (&D)` : `${title} (&D)`;
    browser.menus.create({
	id: id,
	title: title,
	onclick: (info, tab) => {
	    duplicate_tab();
	}
    });

    id = "show_hide_tab";
    title = browser.i18n.getMessage(id);
    title += browser.i18n.getMessage("middle_click");
    shortcut = sc.get(id);
    title = shortcut ? `${title} (${shortcut}) (&H)` : `${title} (&H)`;
    browser.menus.create({
	id: id,
	title: title,
	onclick: (info, tab) => {
	    show_hide_tab();
	}
    });

    id = "open_options_page";
    title = browser.i18n.getMessage(id);
    title += browser.i18n.getMessage("shift_click");
    shortcut = sc.get(id);
    title = shortcut ? `${title} (${shortcut}) (&O)` : `${title} (&O)`;
    browser.menus.create({
	id: id,
	title: title,
	icons: {96: "lib/options.png"},
	onclick: (info, tab) => {
	    browser.runtime.openOptionsPage();
	}
    });
}

browser.browserAction.onClicked.addListener((tab, OnClickData) => {
    if (OnClickData.button == 0) {
	if (OnClickData.modifiers.includes("Ctrl")) {
	    execute_end("abort");
	} else if (OnClickData.modifiers.includes("Shift")) {
	    browser.runtime.openOptionsPage();
	} else {
	    execute();
	}
    } else if (OnClickData.button == 1) {
	if (OnClickData.modifiers.includes("Ctrl")) {
	    duplicate_tab();
	} else {
	    show_hide_tab();
	}
    }
});

browser.commands.onCommand.addListener(key => {
    switch(key) {
    case "start_pause_processing":
	execute();
	break;
    case "end_processing":
	execute_end("abort");
	break;
    case "duplicate_tab":
	duplicate_tab();
	break;
    case "show_hide_tab":
	show_hide_tab();
	break;
    case "open_options_page":
	browser.runtime.openOptionsPage();
	break;
    }
});

async function duplicate_tab() {
    let tab = await get_target_tab();
    if (!tab) {
	notify(browser.i18n.getMessage("tab_not_exist"));
	return;
    }
    let [active] = await browser.tabs.query({currentWindow: true, active: true});
    browser.tabs.duplicate(tab.id, {index: active.index + 1, active: true});
}

async function show_hide_tab() {
    let tab = await get_target_tab();
    if (!tab) {
	notify(browser.i18n.getMessage("tab_not_exist"));
	return;
    }
    if (tab.hidden) {
	await move_to_active(tab.id);
	browser.tabs.update(tab.id, {active: true});
    } else {
	hide_tab(tab);
    }
}

function notify(message, icon) {
    browser.notifications.create({
	type: "basic",
	iconUrl: icon || browser.runtime.getURL("lib/list.svg"),
	title: browser.i18n.getMessage("extension_name"),
	message: message
    });
}

browser.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    switch (request.msg) {
    case "execute":
	execute(request.procedure);
	break;
    case "procedure_file":
	if (!request.procedure) {
	    return;
	}
	let err = await check_procerure(request.procedure);
	if (err.length) {
	    let msg = err.join("\n");
	    notify(msg);
	    return;
	}
	browser.tabs.remove(sender.tab.id);
	execute(request.procedure);
	break;
    }
});

browser.runtime.onInstalled.addListener(async details => {
    switch (details.reason) {
    case "install":
	browser.runtime.openOptionsPage();
	break;
    case "update":
	let a = details.previousVersion.split(".").map(a => ("000" + a).slice(-4)).join(".");
	let b = "1.2022.1015.1".split(".").map(a => ("000" + a).slice(-4)).join(".");
	if (a <= b) {
	    let update_info = browser.i18n.getMessage("update_info");
	    await browser.storage.local.set({update_info});
	    browser.runtime.openOptionsPage();
	} else {
	    browser.storage.local.remove("update_info");
	}
	break;
    }
});

