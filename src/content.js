// inboxy: Chrome extension for Google Inbox-style bundles in Gmail.
// Copyright (C) 2020  Teresa Ou

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import BundleToggler from './bundling/BundleToggler';
import Bundler from './bundling/Bundler';
import DateGrouper from './bundling/DateGrouper';
import SelectiveBundling from './bundling/SelectiveBundling';

import BundledMail from './containers/BundledMail';

import PinnedToggle from './components/PinnedToggle';

import TabPanelsObserver from './handlers/TabPanelsObserver';
import MessageListObserver from './handlers/MessageListObserver';
import MainParentObserver from './handlers/MainParentObserver';
import MessageListWatcher from './handlers/MessageListWatcher';
import StarHandler from './handlers/StarHandler';
import ThemeChangeHandler from './handlers/ThemeChangeHandler';

import {
    getActionsToDisplay,
} from './util/ActionUtils';
import { 
    InboxyClasses,
    Selectors,
} from './util/Constants';
import { 
    supportsBundling,
    isStarredPage,
} from './util/MessagePageUtils';

const DEBUG = true;
const logDebugMessage = message => {
    if (DEBUG) {
        console.log(`inboxy-debug: ${message}`);
    }
};

const html = document.querySelector('html');
if (html) {
    logDebugMessage('Applying styles');
    html.classList.add(InboxyClasses.INBOXY);
}

const RETRY_TIMEOUT_MS = 50;

/* Gmail will relayout the page soon after the first load, so let's wait before the first relayout */
const FIRST_BUNDLE_TIMEOUT = 2000

let isFreshPage = false;
const handleFreshPage = e => isFreshPage = true;

let interactedWithBundle = false;
const handleBundleInteraction = e => interactedWithBundle = true;
const rebundle = () => {
    if (!interactedWithBundle || isFreshPage) {
        bundleToggler.closeAllBundles();
    }
    bundler.bundleMessages(true);

    isFreshPage = false;
    interactedWithBundle = false;
};
const handleGmailRerender = () => {
    if (supportsBundling(window.location.href)) {
        const reopenRecentBundle = !isFreshPage;
        bundler.bundleMessages(reopenRecentBundle);
        starHandler.scrollIfNecessary();
        
        isFreshPage = false;
    }
};

const messageListWatcher = new MessageListWatcher(handleGmailRerender);

const bundledMail = new BundledMail();
const bundleToggler = new BundleToggler(bundledMail);
const selectiveBundling = new SelectiveBundling();
const bundler = new Bundler(bundleToggler, bundledMail, messageListWatcher, selectiveBundling);
const starHandler = new StarHandler(bundledMail, selectiveBundling);
const dateGrouper = new DateGrouper();

// 
// Observers for handling navigation, rerenders by Gmail, etc.
// 
const tabPanelsObserver = new TabPanelsObserver(mutations => rebundle());
const messageListObserver = new MessageListObserver(handleGmailRerender);
const mainParentObserver = new MainParentObserver(mutations => {
    if (supportsBundling(window.location.href)) {
        rebundle();
    }
    else if (isStarredPage(window.location.href)) {
        dateGrouper.refreshDateDividers();
    }
});

//
// Attach event listeners
//
// Call the bundler when the page has loaded.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleContentLoaded);
}
else {
    handleContentLoaded();
}

document.addEventListener('mousedown', starHandler.handleStarring);

// Record when interactions with navigation, refreshes, or bundles occur
document.addEventListener('mousedown', e => {
    if (e.target.matches(Selectors.INBOX_TAB) || 
        e.target.matches(`${Selectors.INBOX_TAB} *`) ||
        e.target.matches(Selectors.PAGECHANGING_BUTTONS) ||
        e.target.matches(`${Selectors.REFRESH} *`)) 
    {
        handleFreshPage(e);
    }
    else if (e.target.matches(`.${InboxyClasses.VIEW_ALL_LINK}`) ||
        e.target.matches(`.${InboxyClasses.VIEW_ALL_LINK} *`) || 
        e.target.matches(`.${InboxyClasses.BUNDLED_MESSAGE}`) ||
        e.target.matches(`.${InboxyClasses.BUNDLED_MESSAGE} *`)) 
    {
        handleBundleInteraction(e);
    }
});


//
// Initial bundling
//

function handleContentLoaded() {
    logDebugMessage('Handle content loaded event');
    const bundleCurrentPage = supportsBundling(window.location.href);
    logDebugMessage(`Url: ${window.location.href}, page supports bundling: ${bundleCurrentPage}`);
    tryBundling(0, bundleCurrentPage);
    hideBulkActionButtonsIfNecessary();
    setTimeout(() => { tryBundling(0, bundleCurrentPage) }, FIRST_BUNDLE_TIMEOUT);
}

function tryBundling(i, bundleCurrentPage) {
    if (i > 100) {
        throw new Error('inboxy was unable to bundle messages. To try again, refresh the page.')
    }

    if (!bundleCurrentPage) {
        // Attach observers so that bundling will occur later when it needs to
        const main = document.querySelector(Selectors.MAIN);
        if (!main) {
            // Try again later
            setTimeout(() => tryBundling(i + 1, bundleCurrentPage), RETRY_TIMEOUT_MS);
        }
        else {
            logDebugMessage('Start observers');

            addPinnedToggle(); 
            startObservers();

            if (isStarredPage(window.location.href)) {
                dateGrouper.refreshDateDividers();
            }
        }
    }
    else {
        // Bundle messages on the current page
        const possibleMessageLists = document.querySelectorAll(Selectors.POSSIBLE_MESSAGE_LISTS);;
        const tableBody = possibleMessageLists.length 
            ? possibleMessageLists.item(0).querySelector(Selectors.TABLE_BODY)
            : null;
        if (!tableBody) {
            // Try again later
            setTimeout(() => tryBundling(i + 1, bundleCurrentPage), RETRY_TIMEOUT_MS);
        }
        else {
            logDebugMessage('Bundle messages');

            const debugInfo = bundler.bundleMessages(false);
            logDebugMessage(JSON.stringify(debugInfo));
            addPinnedToggle();
            startObservers();
        }
    }
}

function startObservers() {
    const themeChangeHandler = new ThemeChangeHandler();
    themeChangeHandler.observe();
    mainParentObserver.observe();
    tabPanelsObserver.observe();
    messageListObserver.observe();
}

function addPinnedToggle() {
    const searchForm = document.querySelector(Selectors.SEARCH_FORM).parentNode;
    let toggle = searchForm.querySelectorAll('.pinned-toggle')
    if(!toggle.length) searchForm.appendChild((new PinnedToggle()).create());
}

function hideBulkActionButtonsIfNecessary() {
    getActionsToDisplay().then(actions => {
        if (!actions.archive) {
            html.classList.add('hide-archive-action');
        }
        if (!actions.delete) {
            html.classList.add('hide-delete-action');
        }
        if (!actions.select) {
            html.classList.add('hide-select-action');
        }
    });
}
