// ==UserScript==
// @name         Mana Donut Chart
// @namespace    http://tampermonkey.net/
// @version      185
// @description  Insert a tappedout.net-style donut chart for mana production and usage.
// @match        https://moxfield.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==


(function () {
    'use strict';

    // Extend logging by prepending the script name and log level to all console methods
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

    console.log("Script loaded on", location.href);

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

    let __lastPage__ = null;
    let __currentController__ = null;

    let pageContainer = ".container.mt-3.mb-5"


    /************************************************************
     * 1. UTILITIES
     ************************************************************/
    function onNewPage() {
        console.debug("Navigated to", location.pathname);
        const deckId = getDeckIdFromPath();
        if (!deckId) {
            __lastPage__ = null;
            // Abort any pending requests
            if (__currentController__) {
                __currentController__.abort();
                __currentController__ = null;
            }
            return;
        };

        const pageKey = location.pathname;
        if (__lastPage__ === pageKey) {
            return;
        }
        // Abort the previous request before starting a new one
        if (__currentController__) {
            __currentController__.abort();
        }
        __lastPage__ = pageKey;

        // Create a new AbortController for this page load
        __currentController__ = new AbortController();
        main(deckId, { signal: __currentController__.signal });
    };


    function getDeckIdFromPath(pathname = location.pathname) {
        const m = pathname.match(/^\/decks\/([^\/?#]+)/);
        return m ? m[1] : null;
    };


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

            observer.observe(
                document.body,
                { childList: true, subtree: true }
            );

            setTimeout(() => {
                observer.disconnect();
                reject(new Error("Timeout: Element not found: " + selector));
            }, timeout);
        });
    };


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
    };


    /**
     * Dynamically inject CSS styles
     */
    function addGlobalStyle(css) {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
    };


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
    };


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
    };


    async function insertHTML() {
        // Wait for the container
        const container = await waitForElement(pageContainer)
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

        const deckId = getDeckIdFromPath()

        // Rerun main when button is clicked
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
    };


    /************************************************************
     * 2. MAIN SCRIPT LOGIC
     ************************************************************/
    async function main(deckId, { signal } = {}) {
        if (deckId == "personal") return;
        console.log("Starting for deck", deckId);

        /**
         * Wait for the page container to load (indicates Moxfield has 
         * initialized the page). This prevents API calls from
         * interfering with Moxfield's own validation. For Packages, the
         * page won't load and we'll timeout. For real Decks, the
         * container will appear and we'll proceed
         */
        const pageIsLoading = new Promise((resolve) => {
            const checkContainer = () => {
                const container = document.querySelector(pageContainer);
                if (container) {
                    resolve(true);
                }
            };

            // Check immediately
            checkContainer();

            // If not found, wait and check again
            if (!document.querySelector(pageContainer)) {
                setTimeout(checkContainer, 1000);
            }
        });

        // Wait for page to load, with a timeout
        const result = await Promise.race([
            pageIsLoading,
            new Promise(resolve => setTimeout(() => {
                console.debug("Page load timeout - likely a Package or error");
                resolve(false);
            }, 1500))
        ]);

        if (!result) {
            console.debug("Page did not load. Skipping...");
            return;
        }

        const urls = [
            `https://api2.moxfield.com/v3/decks/all/${deckId}`,
            `https://api2.moxfield.com/v3/decks/${deckId}`
        ];
        let deckData = null;
        for (const url of urls) {
            console.log("Fetching from", url);
            const res = await fetch(
                url,
                { credentials: 'include', signal }
            ).catch(() => null);
            if (res && res.ok) {
                deckData = await res.json();
                console.log("Data fetched from", url);
                break;
            };
        };

        if (!deckData) {
            // If the signal was aborted, the page navigated away
            // (Moxfield detected a Package)
            if (signal?.aborted) {
                console.debug(
                    "Page navigated (likely a Package, not a Deck).");
                return;
            }

            console.error("Failed to fetch deck data from all endpoints.");
            return;
        };

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
        const myChart = document.getElementById("myChart");
        if (!myChart) {
            console.error("Canvas element not found");
            return;
        };
        const ctx = myChart.getContext("2d");

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
                                const total = context.dataset.data.reduce((a, b) => a + b, 0)
                                const percentage = (context.parsed / total * 100).toFixed(0)
                                console.debug(context)
                                return `${context.parsed} symbols (${percentage}%)`
                            }
                        }
                    }
                }
            }
        });
    };

    /**
     * When pushState or replaceState is called, patch the original
     * function with a wrapper that triggers onNewPage after the
     * original function executes.
     * pushState adds a new entry in the browser history, changes the
     * URL, but does not reload the page.
     * replaceState modifies the current history entry, changes the URL,
     * but does not reload the page
     */
    ['pushState', 'replaceState'].forEach(func => {
        const orig = history[func];
        // Call the original function, store original return value,
        // trigger onNewPage, return original return value
        history[func] = function (...args) {
            const originalReturnValue = orig.apply(this, args);
            // run after the history call settles
            queueMicrotask(onNewPage);
            return originalReturnValue;
        };
    });
    window.addEventListener("popstate", onNewPage);
    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            onNewPage,
            { once: true }
        );
    } else {
        onNewPage();
    };
})();
