/* SPDX-License-Identifier: MIT */
/*
 * Pass-through replacement for ngspice's numparam front-end interface.
 *
 * ngspice's stock build always links numparam (LGPL-2.1). The license-clean
 * CircuitGate build removes that module and links this shim instead. All
 * entry points are inert: decks pass through unchanged, and parameter
 * expansion is performed by the TypeScript model front end before the deck
 * is handed to the engine (KTD1/KTD6).
 */
#ifndef CG_NUMPAIF_H
#define CG_NUMPAIF_H

#include <stdio.h>

#define NUPADECKCOPY 0
#define NUPASUBSTART 1
#define NUPASUBDONE 2
#define NUPAEVALDONE 3

struct card;

extern char *nupa_copy(struct card *c);
extern int nupa_eval(struct card *card);
extern void nupa_signal(int sig);
extern void nupa_scan(const struct card *card);
extern void nupa_list_params(FILE *cp_out);
extern double nupa_get_param(const char *param_name, int *found);
extern const char *nupa_get_string_param(const char *param_name);
extern void nupa_add_param(char *param_name, double value);
extern void nupa_copy_inst_dico(void);
extern void nupa_del_dicoS(void);
extern int nupa_add_dicoslist(void);
extern void nupa_rem_dicoslist(int index);
extern void nupa_set_dicoslist(int index);

extern int dynMaxckt;

#endif
