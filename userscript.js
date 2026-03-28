// ==UserScript==
// @name         Mana Donut Chart
// @namespace    http://tampermonkey.net/
// @version      103
// @description  Insert a tappedout.net-style donut chart for mana production and usage.
// @match        https://moxfield.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

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

        // if ((colorCharacter == "{C}") && ((landMana > 0) || (cardCost > 0))) {
        //     console.log(face["name"])
        //     console.log(cardCost)
        //     console.log(landMana)
        // }

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
            // console.log(rawCard)
            const card = rawCard["card"]
            // if (card["name"] == "Ishai, Ojutai Dragonspeaker") {
            //     console.log("Ishai logged")
            // }

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

    /************************************************************
     * 2. MAIN SCRIPT LOGIC
     ************************************************************/

    async function main(deckId, { signal } = {}) {
        console.log("Userscript: starting for deck", deckId);

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

        // Wait for the container
        const container = await waitForElement(".container.mt-3.mb-5")
            .catch(() => null);
        if (!container) return;

        // Prevent duplicates when switching between decks
        if (container.querySelector('.chart-container')) {
            container.querySelector('.chart-container').remove();
        }

        // Create the regex for counting mana symbols in card text
        const whitePattern = /\b[Aa]dd\b[^.]*?\{W\}/g
        const bluePattern = /\b[Aa]dd\b[^.]*?\{U\}/g
        const blackPattern = /\b[Aa]dd\b[^.]*?\{B\}/g
        const redPattern = /\b[Aa]dd\b[^.]*?\{R\}/g
        const greenPattern = /\b[Aa]dd\b[^.]*?\{G\}/g
        const colorlessPattern = /\b[Aa]dd\b[^.]*?\{C\}/g

        // Count the symbols for each color
        const whiteSymbols = countColors(cards, "{W}", whitePattern)
        const blueSymbols = countColors(cards, "{U}", bluePattern)
        const blackSymbols = countColors(cards, "{B}", blackPattern)
        const redSymbols = countColors(cards, "{R}", redPattern)
        const greenSymbols = countColors(cards, "{G}", greenPattern)
        const colorlessSymbols = countColors(cards, "{C}", colorlessPattern)

        // Example: Insert a custom UI element
        const box = document.createElement("div");
        box.className = "chart-container";
        box.innerHTML = `
            <h2 class="chart-title">Card costs (outer)<br>Land mana (inner)</h2>
            <canvas id="myChart" width="200" height="200"></canvas>
        `;
        // Avoid duplicate insertion
        if (!container.querySelector('.chart-container')) {

            // Locate only <hr> elements that are DIRECT children of the container
            const directHrs = Array.from(container.children).filter(
                el => el.tagName === "HR"
            );

            if (directHrs.length >= 2) {
                container.insertBefore(box, directHrs[1]);
            } else {
                container.appendChild(box);
            }
        }

        // Example: Add CSS
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
        `);

        // Example: Load Chart.js
        await loadScript("https://cdn.jsdelivr.net/npm/chart.js");

        // Example: Draw a nested pie chart
        const WHITE = "#f0f2c0"
        const BLUE = "#b5cde3"
        const BLACK = "#aca29a"
        const RED = "#db8664"
        const GREEN = "#93b483"
        const COLORLESS = "#beb9b2"

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
