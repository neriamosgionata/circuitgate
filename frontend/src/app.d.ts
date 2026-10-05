// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Me {
			id: string;
			email: string;
			verified: boolean;
		}
		// interface Error {}
		// interface Locals {}
		interface PageData {
			user?: Me;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
