import { describe, expect, it } from 'vitest';

import type { NetlistProblem } from '../../../engine/analog/netlist';
import type { Diagnostic } from '../../diagnostics';
import {
	analogDiagnostic,
	floatingDiagnostic,
	isSolverFailure,
	loadFailureDiagnostic,
	modelProblemDiagnostic,
	noGroundDiagnostic,
	parameterProblemDiagnostic,
	solverDiagnostic,
	unboundMeasurementDiagnostic
} from '../diagnostics';

describe('analog diagnostic construction', () => {
	it('builds an analog diagnostic with code, analysis, net, and component context', () => {
		const diagnostic: Diagnostic = analogDiagnostic('floating', 'message', {
			analysisId: 'op1',
			nets: ['iso'],
			componentIds: ['c1']
		});
		expect(diagnostic.kind).toBe('analog');
		expect(diagnostic.code).toBe('floating');
		expect(diagnostic.message).toBe('message');
		expect(diagnostic.analysisId).toBe('op1');
		expect(diagnostic.nets).toEqual(['iso']);
		expect(diagnostic.componentIds).toEqual(['c1']);
		expect(diagnostic.id.length).toBeGreaterThan(0);
	});

	it('gives diagnostics distinct ids for distinct context and stable ids for repeats', () => {
		const first = floatingDiagnostic('iso', 'op1');
		const second = floatingDiagnostic('iso', 'op1');
		const other = floatingDiagnostic('other', 'op1');
		expect(first.id).toBe(second.id);
		expect(other.id).not.toBe(first.id);
	});

	it('names the floating net and the analysis in the floating diagnostic', () => {
		const diagnostic = floatingDiagnostic('iso net', 'tran1');
		expect(diagnostic.code).toBe('floating');
		expect(diagnostic.analysisId).toBe('tran1');
		expect(diagnostic.nets).toEqual(['iso net']);
		expect(diagnostic.message).toContain('iso net');
		expect(diagnostic.message).toContain('DC');
	});

	it('names the affected nets and asks for a ground component when none exists', () => {
		const diagnostic = noGroundDiagnostic(['vin', 'vout']);
		expect(diagnostic.code).toBe('no-ground');
		expect(diagnostic.nets).toEqual(['vin', 'vout']);
		expect(diagnostic.message).toContain('vin');
		expect(diagnostic.message).toContain('ground');
	});

	it('maps netlist parameter-cap problems to parameter-cap diagnostics', () => {
		const problem: NetlistProblem = {
			code: 'parameter-cap',
			message: 'transient needs too many steps',
			analysisId: 'tran1',
			componentIds: ['r1']
		};
		const diagnostic = parameterProblemDiagnostic(problem);
		expect(diagnostic.code).toBe('parameter-cap');
		expect(diagnostic.analysisId).toBe('tran1');
		expect(diagnostic.componentIds).toEqual(['r1']);
		expect(diagnostic.message).toContain('too many steps');
	});

	it('maps netlist model problems to model diagnostics', () => {
		const problem: NetlistProblem = {
			code: 'model-unresolved',
			message: 'unresolved model missing',
			componentIds: ['d1']
		};
		const diagnostic = modelProblemDiagnostic(problem);
		expect(diagnostic.code).toBe('model');
		expect(diagnostic.componentIds).toEqual(['d1']);
		expect(diagnostic.message).toContain('missing');
	});

	it('names the measurement and the unbound target', () => {
		const diagnostic = unboundMeasurementDiagnostic('gain', 'v(nope)');
		expect(diagnostic.code).toBe('unbound-measurement');
		expect(diagnostic.message).toContain('gain');
		expect(diagnostic.message).toContain('v(nope)');
	});

	it('describes a load failure as retryable', () => {
		const diagnostic = loadFailureDiagnostic('engine asset fetch failed: 404');
		expect(diagnostic.code).toBe('load-failure');
		expect(diagnostic.message).toContain('404');
		expect(diagnostic.message.toLowerCase()).toContain('retry');
	});
});

describe('solver failure classification', () => {
	it('detects singular matrix, timestep, and convergence failures', () => {
		expect(isSolverFailure(['Warning: singular matrix:  check node 2'])).toBe(true);
		expect(isSolverFailure(['doAnalyses: TRAN:  Timestep too small'])).toBe(true);
		expect(isSolverFailure(['source stepping failed'])).toBe(true);
		expect(isSolverFailure(['Dynamic gmin stepping failed'])).toBe(true);
		expect(isSolverFailure(['Warning: singular matrix', 'Transient op finished successfully'])).toBe(true);
	});

	it('does not flag benign engine chatter', () => {
		expect(isSolverFailure(['Warning: memory required (23 kB)'])).toBe(false);
		expect(isSolverFailure([])).toBe(false);
	});

	it('builds a solver diagnostic with guidance and a null-on-clean contract', () => {
		const diagnostic = solverDiagnostic('op1', ['Warning: singular matrix:  check node 2']);
		expect(diagnostic).not.toBeNull();
		expect(diagnostic?.code).toBe('solver');
		expect(diagnostic?.analysisId).toBe('op1');
		expect(diagnostic?.message).toContain('singular matrix');
		expect(diagnostic?.message.toLowerCase()).toContain('dc path');
		expect(solverDiagnostic('op1', ['Warning: memory required (23 kB)'])).toBeNull();
	});
});
