import * as vscode from 'vscode';
import { getNRFJProgPath } from './extension';
import { execAsync } from './utils';

export interface Board {
	name: string,
	id: string,
	chips: BoardChip[]
}

export interface BoardChip {
	name: string,
	id: string,
	jlinkDevice: string,
	allowsSecureBuild: boolean
}

const nRF9160: BoardChip = {
	id: "nrf9160",
	name: "nRF 9160",
	jlinkDevice: "nrf9160",
	allowsSecureBuild: true
};

const nRF52840: BoardChip = {
	id: "nrf52840",
	name: "nRF 52840",
	jlinkDevice: "nrf52",
	allowsSecureBuild: false
};

// Note: Keep in sync with package.json:'ardesco.board.chip' enum.
export const chips: BoardChip[] = [
	nRF9160,
	nRF52840
];

// Note: Keep in sync with package.json:'ardesco.board.name' enum.
export const boards: Board[] = [
	{id: "ard0021B", name: "Ardesco Combi", chips: [nRF9160, nRF52840]},
	{id: "ard0022B", name: "Ardesco Combi Dev", chips: [nRF9160, nRF52840]},
	{id: "ard0031A", name: "Ardesco Mini", chips: [nRF9160, nRF52840]},
	{id: "ard0011A", name: "Ardesco Prototype", chips: [nRF9160, nRF52840]},
	{id: "pca10090", name: "Nordic 9160 DK", chips: [nRF9160, nRF52840]},
	{id: "pca20035", name: "Nordic Thingy 91", chips: [nRF9160, nRF52840]}
];

export function getBoards(): Board[] {
	return boards;
}

export function getBoard(): Board {
	const config = vscode.workspace.getConfiguration('ardesco');
	const boardName = config.get('board.name');
	if (!boardName)
		return boards[0];

	const board = boards.find(b => b.name == boardName || b.id == boardName);
	return board!;
}

export function getBoardChip(): BoardChip {
	const config = vscode.workspace.getConfiguration('ardesco');
	const chipName = config.get('board.chip');
	if (!chipName)
		return getBoard().chips[0];

	const chip = chips.find(c => c.name == chipName || c.id == chipName)
	return chip!;
}

export function doesAllowNonSecureBuild(chip: BoardChip) {
	return chip.id.startsWith('nrf9');
}

export function getZephyrBoardSpec() {
	const board = getBoard();
	const chip = getBoardChip();
	let boardSpec: string = `${chip.id}_${board.id}`;

	const config = vscode.workspace.getConfiguration('ardesco');
	const secure: boolean = config.get('secureBuild') || false;
	if (doesAllowNonSecureBuild(chip) && (!secure)) {
		boardSpec = `${boardSpec}ns`;
	}

	return boardSpec;
}

// For device identification, we read the memory address associated with
// FICR (Factory information configuration registers). This address is
// different between different chip families, check the links below for
// more information.
//
// nRF52:
//  https://infocenter.nordicsemi.com/topic/ps_nrf52840/ficr.html
//
// nRF91:
//  https://infocenter.nordicsemi.com/topic/ps_nrf9160/ficr.html

const chipPartInfo = [
	{chip: nRF52840, address: 0x10000000 + 0x100, value: 0x52000, mask: 0xff000},
	{chip: nRF9160,  address: 0x00FF0000 + 0x20C, value: 0x9100,  mask: 0xff00}
];

export function isNordicChip(chip: BoardChip) {
	return chip.id.startsWith('nrf');
}

export async function getJLinkChipPartId(): Promise<BoardChip|null> {
	const nrfjprog = await getNRFJProgPath();
	if (!nrfjprog) {
		return null;
	}

	for (const info of chipPartInfo) {
		try {
			const args = ['--memrd', '0x' + info.address.toString(16), '--n', '4'];
			const [stderr, stdout] = await execAsync(nrfjprog, args);

			const regexp = /0[xX][0-9a-fA-F]+: (\d+).*/;
			const match = stdout.match(regexp);
			if (!match || !match[1])
				continue;

			let value = Number.parseInt(match[1], 16);
			value &= info.mask;
			if (value == info.value)
				return info.chip;
		} catch (e) {
			return null;
		}
	}

	return  null;
}
