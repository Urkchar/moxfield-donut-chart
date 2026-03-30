// ==UserScript==
// @name         Mana Donut Chart
// @namespace    http://tampermonkey.net/
// @version      152
// @description  Insert a tappedout.net-style donut chart for mana production and usage.
// @match        https://moxfield.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==


(function () {
    'use strict';

    // Extend logging
    const originalError = console.error;
    console.error = (...args) => {
        originalError("[Mana Donut Chart] [ERROR]", ...args);
    };
    const originalWarn = console.warn;
    console.warn = (...args) => {
        originalWarn("[Mana Donut Chart] [WARN]", ...args);
    };
    const originalLog = console.log;
    console.log = (...args) => {
        originalLog("[Mana Donut Chart] [INFO]", ...args);
    };
    const originalInfo = console.info;
    console.info = (...args) => {
        originalInfo("[Mana Donut Chart] [INFO]", ...args);
    };
    const originalDebug = console.debug;
    console.debug = (...args) => {
        originalDebug("[Mana Donut Chart] [DEBUG]", ...args);
    };

    // Create the regex for counting mana symbols in card text
    const whitePattern = /\b[Aa]dd\b[^.]*?\{W\}/g;
    const bluePattern = /\b[Aa]dd\b[^.]*?\{U\}/g;
    const blackPattern = /\b[Aa]dd\b[^.]*?\{B\}/g;
    const redPattern = /\b[Aa]dd\b[^.]*?\{R\}/g;
    const greenPattern = /\b[Aa]dd\b[^.]*?\{G\}/g;
    const colorlessPattern = /\b[Aa]dd\b[^.]*?\{C\}/g;

    // Create shorthand for colors
    const WHITE = "#f0f2c0";
    const BLUE = "#b5cde3";
    const BLACK = "#aca29a";
    const RED = "#db8664";
    const GREEN = "#93b483";
    const COLORLESS = "#beb9b2";

    let __lastRouteRan__ = null;

    // --- 0) Utility: deckId from URL ---
    function getDeckIdFromPath(pathname = location.pathname) {
        const m = pathname.match(/^\/decks\/([^\/?#]+)/);
        return m ? m[1] : null;
    }

    // --- 1) Single, canonical route entry ---
    function onRouteChange() {
        const deckId = getDeckIdFromPath();
        if (!deckId) {
            __lastRouteRan__ = null;   // reset when leaving deck routes
            return;
        }

        const routeKey = location.pathname;

        if (__lastRouteRan__ === routeKey) return;
        __lastRouteRan__ = routeKey;

        safeMain(deckId);
    }

    // --- 2) Never bind `main` directly; use this wrapper ---
    let __currentController = null;                       // for aborting in-flight fetches
    async function safeMain(arg) {
        // If `safeMain` is accidentally used as an event handler, fix it.
        let deckId = (typeof arg === 'string') ? arg : getDeckIdFromPath();
        if (typeof deckId !== 'string' || !deckId) return;  // abort: not a valid deck id

        // Cancel any in-flight work for previous deck
        if (__currentController) __currentController.abort();
        __currentController = new AbortController();

        try {
            await main(deckId, { signal: __currentController.signal });
        } catch (e) {
            if (e?.name !== 'AbortError') console.warn('main failed:', e);
        }
    }

    // --- 3) History/route hooks (SPA) ---
    ['pushState', 'replaceState'].forEach(fn => {
        const orig = history[fn];
        history[fn] = function (...args) {
            const ret = orig.apply(this, args);
            // run after the history call settles
            queueMicrotask(onRouteChange);
            return ret;
        };
    });
    window.addEventListener('popstate', onRouteChange);   // back/forward -> route handler

    // --- 4) Boot once on initial load (no direct call to `main`) ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onRouteChange, { once: true });
    } else {
        onRouteChange();
    }


    /************************************************************
     * 1. UTILITIES
     ************************************************************/

    /**
     * Wait for an element to appear in the DOM (Promise-based)
     * @param {string} selector
     * @param {number} timeout (optional ms)
     */
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) return resolve(element);

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error("Timeout: Element not found: " + selector));
            }, timeout);
        });
    }

    /**
     * Dynamically load a script (e.g., Chart.js)
     * @param {string} url
     * @returns {Promise}
     */
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = url;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Dynamically inject CSS styles
     */
    function addGlobalStyle(css) {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
    }

    /**
     * Count mana symbols of a card face
     * @param {object} face
     * @param {string} colorCharacter
     * @param {object} pattern
     * @returns {Array}
     */
    function countFace(face, colorCharacter, pattern) {
        const cardCost = face["mana_cost"].split(colorCharacter).length - 1

        if (face["type"] == 8) {
            var landMana = (face["oracle_text"].match(pattern) || []).length
        }
        else {
            var landMana = 0
        }

        return [cardCost, landMana]
    }

    /**
     * Count mana production and card costs for a given color
     * @param {object} cards
     * @param {string} colorCharacter
     * @param {object} pattern
     * @returns {Array}
     */
    function countColors(cards, colorCharacter, pattern) {
        let cardCosts = 0
        let landMana = 0

        for (const [_, rawCard] of Object.entries(cards)) {
            const card = rawCard["card"]

            if (card["card_faces"].length > 0) {
                for (const [_, face] of Object.entries(card["card_faces"])) {
                    const faceColors = countFace(face, colorCharacter, pattern)
                    cardCosts += faceColors[0] * rawCard["quantity"]
                    landMana += faceColors[1] * rawCard["quantity"]
                }
            }
            else {
                const faceColors = countFace(card, colorCharacter, pattern)
                cardCosts += faceColors[0] * rawCard["quantity"]
                landMana += faceColors[1] * rawCard["quantity"]
            }
        }

        return [cardCosts, landMana]
    }

    async function insertHTML() {
        // Wait for the container
        const container = await waitForElement(".container.mt-3.mb-5")
            .catch(() => null);
        if (!container) return;

        // Prevent duplicates when switching between decks
        if (container.querySelector('.chart-container')) {
            container.querySelector('.chart-container').remove();
        }

        // Create elements
        const row = document.createElement("div")
        const chartContainer = document.createElement("div")
        const chartTitle = document.createElement("h2")
        const chartTitleText1 = document.createElement("span")
        const lineBreak = document.createElement("br")
        const chartTitleText2 = document.createElement("span")
        const canvas = document.createElement("canvas")
        const btnWrapper = document.createElement("div")
        const refreshBtn = document.createElement("button")
        const refreshBtnText = document.createElement("span")

        // Add text
        chartTitleText1.textContent = "Card costs (outer)"
        chartTitleText2.textContent = "Land mana (inner"
        refreshBtnText.textContent = "Refresh"

        // Add classes and attributes
        chartContainer.classList.add("chart-container")
        chartTitle.classList.add("chart-title")
        btnWrapper.classList.add("btn-wrap")
        refreshBtn.classList.add("btn")
        refreshBtn.classList.add("btn-primary")
        refreshBtn.classList.add("btn-refresh")
        refreshBtn.type = "button"
        refreshBtn.ariaLabel = "Refresh"
        canvas.id = "myChart"
        canvas.width = 200
        canvas.height = 200

        // Nest elements
        row.appendChild(chartContainer)
        chartContainer.appendChild(chartTitle)
        chartTitle.appendChild(chartTitleText1)
        chartTitle.appendChild(lineBreak)
        chartTitle.appendChild(chartTitleText2)
        chartContainer.appendChild(canvas)
        chartContainer.appendChild(btnWrapper)
        btnWrapper.appendChild(refreshBtn)
        refreshBtn.appendChild(refreshBtnText)

        refreshBtn.addEventListener("click", () => {
            console.log("Manual refresh");
            safeMain(deckId);
        })

        // Avoid duplicate insertion
        if (!container.querySelector('.chart-container')) {
            console.debug("Inserting HTML...")

            const rows = container.querySelectorAll(".row")
            console.debug(`Found ${rows.length} rows.`);
            rows[1]?.before(row);

            console.debug("HTML interted.")
        }
        else {
            console.debug("HTML already inserted.")
        }

        // Add CSS
        addGlobalStyle(`
            .chart-container {
                padding: 12px;
                margin: 12px 0;
                width: 40%;
                margin-left: auto;
                margin-right: auto;
            }
            .chart-title {
                text-align: center;
            }
            /* Wrapper to center the button horizontally */
            .btn-wrap {
                display: flex;
                justify-content: center;
                /* Optional spacing around the button */
                margin: 1rem 0;
            }
        `);
    }

    /************************************************************
     * 2. MAIN SCRIPT LOGIC
     ************************************************************/

    async function main(deckId, { signal } = {}) {
        if (deckId == "personal") return;
        console.log("Starting for deck", deckId);

        // Direct fetch with AbortController support
        const urls = [
            `https://api2.moxfield.com/v3/decks/all/${deckId}`,
            `https://api2.moxfield.com/v3/decks/${deckId}`
        ];
        let deckData = null;
        for (const url of urls) {
            const res = await fetch(url, { credentials: 'include', signal }).catch(() => null);
            if (res && res.ok) { deckData = await res.json(); break; }
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        }
        if (!deckData) return; // could not load (private deck, offline, etc.)

        // Build the cards map (guard for commanders not present)
        const cards = {
            ...(deckData?.boards?.mainboard?.cards || {}),
            ...(deckData?.boards?.commanders?.cards || {})
        };

        // Count the symbols for each color
        const whiteSymbols = countColors(cards, "{W}", whitePattern)
        const blueSymbols = countColors(cards, "{U}", bluePattern)
        const blackSymbols = countColors(cards, "{B}", blackPattern)
        const redSymbols = countColors(cards, "{R}", redPattern)
        const greenSymbols = countColors(cards, "{G}", greenPattern)
        const colorlessSymbols = countColors(cards, "{C}", colorlessPattern)

        await insertHTML();

        // Load Chart.js
        await loadScript("https://cdn.jsdelivr.net/npm/chart.js");

        // Draw the nested pie chart
        const ctx = document.getElementById("myChart").getContext("2d");

        const outerData = [
            whiteSymbols[0],
            blueSymbols[0],
            blackSymbols[0],
            redSymbols[0],
            greenSymbols[0],
        ]
        const innerData = [
            whiteSymbols[1],
            blueSymbols[1],
            blackSymbols[1],
            redSymbols[1],
            greenSymbols[1],
        ]
        const backgroundColors = [WHITE, BLUE, BLACK, RED, GREEN]

        if (colorlessSymbols[0] > 0) {
            outerData.push(colorlessSymbols[0])
            innerData.push(colorlessSymbols[1])
            backgroundColors.push(COLORLESS)
        }

        new Chart(ctx, {
            type: "doughnut",
            data: {
                datasets: [
                    {
                        // Outer ring
                        data: outerData,
                        backgroundColor: backgroundColors,
                        weight: 1
                    },
                    {
                        // Inner pie
                        data: innerData,
                        backgroundColor: backgroundColors,
                        weight: 3
                    }
                ]
            },
            options: {
                cutout: "0%",
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.parsed} symbols`
                            }
                        }
                    }
                }
            }
        });
    }
})();
