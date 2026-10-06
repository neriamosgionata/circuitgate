import type { NetlistProblem } from '../../engine/analog/netlist';
import type { Diagnostic } from '../diagnostics';

export type AnalogDiagnosticCode =
	| 'solver'
	| 'model'
	| 'floating'
	| 'no-ground'
	| 'parameter-cap'
	| 'parameter-invalid'
	| 'unbound-measurement'
	| 'unconnected-pin'
	| 'load-failure';

export interface AnalogDiagnosticContext {
	id?: string;
	analysisId?: string;
	nets?: readonly string[];
	componentIds?: readonly string[];
}

export function analogDiagnostic(
	code: AnalogDiagnosticCode,
	message: string,
	context: AnalogDiagnosticContext = {}
): Diagnostic {
	const parts = [
		'analog',
		code,
		context.analysisId ?? '',
		(context.nets ?? []).join(','),
		(context.componentIds ?? []).join(','),
		message
	];
	return {
		id: context.id ?? parts.join(':'),
		kind: 'analog',
		code,
		message,
		...(context.analysisId === undefined ? {} : { analysisId: context.analysisId }),
		...(context.nets === undefined ? {} : { nets: [...context.nets] }),
		...(context.componentIds === undefined ? {} : { componentIds: [...context.componentIds] })
	};
}

const SOLVER_FAILURE_PATTERNS: readonly RegExp[] = [
	/singular matrix/i,
	/timestep too small/i,
	/do not converge/i,
	/did not converge/i,
	/source stepping failed/i,
	/gmin stepping failed/i,
	/convergence failure/i,
	/run simulation\(s\) aborted/i,
	/simulation aborted/i
];

const SOLVER_GUIDANCE =
	'Check the circuit for floating nets, contradictory sources, or unrealistic component values; add an explicit DC path to ground or initial conditions, then retry.';

export function isSolverFailure(lines: readonly string[]): boolean {
	return lines.some((line) => SOLVER_FAILURE_PATTERNS.some((pattern) => pattern.test(line)));
}

export function solverDiagnostic(analysisId: string, lines: readonly string[]): Diagnostic | null {
	const failure = lines.find((line) => SOLVER_FAILURE_PATTERNS.some((pattern) => pattern.test(line)));
	if (failure === undefined) return null;
	return analogDiagnostic('solver', `solver failed: ${failure.trim()}. ${SOLVER_GUIDANCE}`, {
		analysisId
	});
}

export function floatingDiagnostic(net: string, analysisId?: string): Diagnostic {
	return analogDiagnostic(
		'floating',
		`no DC path to ground from net ${net}; add a path resistor or connect it to ground`,
		{ nets: [net], ...(analysisId === undefined ? {} : { analysisId }) }
	);
}

export function noGroundDiagnostic(nets: readonly string[]): Diagnostic {
	const listed = nets.slice(0, 8).join(', ');
	return analogDiagnostic(
		'no-ground',
		`no ground reference: nets ${listed} have no DC path to ground. Place a ground component.`,
		{ nets }
	);
}

function netlistProblemDiagnostic(code: AnalogDiagnosticCode, problem: NetlistProblem): Diagnostic {
	return analogDiagnostic(code, problem.message, {
		...(problem.analysisId === undefined ? {} : { analysisId: problem.analysisId }),
		...(problem.componentIds === undefined ? {} : { componentIds: problem.componentIds }),
		...(problem.nets === undefined ? {} : { nets: problem.nets })
	});
}

export function parameterProblemDiagnostic(problem: NetlistProblem): Diagnostic {
	return netlistProblemDiagnostic(problem.code === 'parameter-cap' ? 'parameter-cap' : 'parameter-invalid', problem);
}

export function modelProblemDiagnostic(problem: NetlistProblem): Diagnostic {
	return netlistProblemDiagnostic('model', problem);
}

export function unboundMeasurementDiagnostic(name: string, signal: string, analysisId?: string): Diagnostic {
	return analogDiagnostic(
		'unbound-measurement',
		`measurement ${name} cannot bind: ${signal} is not present in the results`,
		{ ...(analysisId === undefined ? {} : { analysisId }) }
	);
}

export function loadFailureDiagnostic(message: string): Diagnostic {
	return analogDiagnostic('load-failure', `${message}. Check the connection and retry.`);
}
