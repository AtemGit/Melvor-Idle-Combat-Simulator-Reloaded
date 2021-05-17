/*  Melvor Idle Combat Simulator

    Modified Copyright (C) <2020, 2021> <G. Miclotte>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// set global variable
window.MICSR = {
    isDev: false,
    /////////////
    // logging //
    /////////////
    debug: (...args) => console.log('MICSR debugging:', ...args),
    log: (...args) => console.log('MICSR:', ...args),
    warn: (...args) => console.warn('MICSR:', ...args),
    error: (...args) => console.error('MICSR:', ...args),

    /////////////
    // loading //
    /////////////
    loadedFiles: {},
}


// set itemID for each item
items.forEach((x, i) => {
    x.itemID = i;
});