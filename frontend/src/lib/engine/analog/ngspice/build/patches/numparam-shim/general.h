/* SPDX-License-Identifier: MIT */
/*
 * Minimal replacement for ngspice's numparam helper interface.
 *
 * The license-clean CircuitGate build excludes ngspice's numparam module
 * (LGPL-2.1) and replaces it with the pass-through shim in this directory.
 * Only the DSTRING append helpers used by ngspice's device parser remain;
 * parameter and brace-expression handling happens in the TypeScript model
 * front end before a deck reaches the engine (see KTD6).
 */
#ifndef CG_NUMPARAM_GENERAL_H
#define CG_NUMPARAM_GENERAL_H

#include <stdio.h>

#include "ngspice/dstring.h"
#include "ngspice/bool.h"

void sadd(DSTRINGPTR s, const char *t);
void cadd(DSTRINGPTR s, char c);

#endif
