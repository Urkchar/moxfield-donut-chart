# Installation
1. Navigate to https://www.tampermonkey.net/.
2. Scroll down to the DOWNLOAD section.
3. Click the green `Get from store` button in the Tampermonkey box.
4. Click the blue `Add to Chrome` button.
5. Agree to the requested permissions and click the `Add extension` button.
6. Click the `Extensions` puzzle piece button to the right of the address bar.
7. Click the three dots (`More options`) button next to `Tampermonkey`.
8. Click `Manage extension` in the dropdown.
9. Toggle the `Allow User Scripts` radio button `On`.
10. Click the `Extensions` puzzle piece button to the right of the address bar.
11. Click `Tampermonkey` in the extensions dropdown.
12. Click `Dashboard` in the Tampermonkey dropdown.
13. In the top right, click the `+` (`Create a new script...`) button.
14. Replace the code in the editor with the code from https://github.com/Urkchar/moxfield-donut-chart/blob/main/userscript.js.
15. Press `CTRL` + `S` to save the script.
16. Navigate to any https://moxfield.com/decks/* page.
17. Enjoy.

# Use
The outer ring of the chart displays the ratio of colored and/or colorless mana symbols in card costs. 
The inner pie of the chart displays the ratio of colored and/or colorless mana symbols that lands can produce. 
Hover over a section of the pie or the ring to see the exact count of symbols for that color.
Colorless mana symbols on lands are only displayed if there are one or more colorless mana symbols in card costs. 
Click the `Refresh` button to recalculate the mana symbol counts after you've added, removed, or changed the quantity of cards.