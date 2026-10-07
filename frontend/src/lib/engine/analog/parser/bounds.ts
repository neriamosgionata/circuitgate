/**
 * Model-parser bounds and public types (U8, KTD6). Every cap is enforced by
 * the character-scanner front end before any text can reach the engine; the
 * same constants gate both import-time validation and the worker's per-run
 * re-validation.
 */
import { MAX_MODEL_TEXT_LENGTH } from '../../../model/schema';

export const MODEL_FORMAT_VERSION = 1;

export const ModelCaps = {
	maxTextLength: MAX_MODEL_TEXT_LENGTH,
	maxLines: 2_000,
	maxLineLength: 2_000,
	maxTokensPerLine: 512,
	maxTokenLength: 128,
	maxIdentifierLength: 64,
	maxNodes: 128,
	maxParameters: 256,
	maxSubcircuitDepth: 8,
	maxExpandedInstances: 1_000
} as const;

export type ParseFailure = { ok: false; message: string };

export interface ParsedElement {
	designator: string;
	canonical: string;
}

export interface ParsedDeviceModel {
	kind: 'model';
	name: string;
	type: string;
	parameters: Readonly<Record<string, number>>;
	canonical: string;
}

export interface ParsedSubcircuit {
	kind: 'subckt';
	name: string;
	terminals: readonly string[];
	parameters: Readonly<Record<string, number>>;
	elements: readonly ParsedElement[];
	canonicalHeader: string;
	canonicalBody: readonly string[];
}

export type ParsedDefinition = ParsedDeviceModel | ParsedSubcircuit;

export interface ParsedModel {
	name: string;
	formatVersion: number;
	root: ParsedDefinition;
	definitions: readonly ParsedDefinition[];
	/** Canonical re-emission of every accepted definition, in source order. */
	canonical: readonly string[];
	nodes: readonly string[];
	depth: number;
	expandedInstances: number;
}

export type ParseResult = { ok: true; model: ParsedModel } | ParseFailure;

export function parseFailure(message: string): ParseFailure {
	return { ok: false, message };
}

export class ModelParseError extends Error {}

export function fail(message: string): never {
	throw new ModelParseError(message);
}
