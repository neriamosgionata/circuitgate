/* SPDX-License-Identifier: MIT */
/*
 * Pass-through numparam replacement for the license-clean ngspice build.
 *
 * See numpaif.h. `sadd`/`cadd` are the only helpers ngspice's device parser
 * calls into this module; the nupa_* entry points keep their upstream
 * semantics where a no-op would change control flow:
 *   - nupa_copy returns the line unchanged (no expansion),
 *   - nupa_eval reports "not evaluated" so callers surface a diagnostic.
 */
#include <stdio.h>

#include "ngspice/ngspice.h"
#include "ngspice/dstring.h"
#include "ngspice/inpdefs.h"

#include "general.h"
#include "numpaif.h"

void
sadd(DSTRINGPTR dstr_p, const char *t)
{
    if (dstr_p && t)
        (void) ds_cat_str(dstr_p, t);
}

void
cadd(DSTRINGPTR dstr_p, char c)
{
    if (dstr_p)
        (void) ds_cat_char(dstr_p, c);
}

void
nupa_signal(int sig)
{
    (void) sig;
}

void
nupa_scan(const struct card *card)
{
    (void) card;
}

char *
nupa_copy(struct card *c)
{
    return c ? c->line : NULL;
}

int
nupa_eval(struct card *card)
{
    (void) card;
    return 0;
}

void
nupa_list_params(FILE *cp_out)
{
    (void) cp_out;
}

void
nupa_add_param(char *param_name, double value)
{
    (void) param_name;
    (void) value;
}

void
nupa_copy_inst_dico(void)
{
}

void
nupa_del_dicoS(void)
{
}

int
nupa_add_dicoslist(void)
{
    return 0;
}

void
nupa_rem_dicoslist(int index)
{
    (void) index;
}

void
nupa_set_dicoslist(int index)
{
    (void) index;
}

double
nupa_get_param(const char *param_name, int *found)
{
    (void) param_name;
    if (found)
        *found = 0;
    return 0.0;
}

const char *
nupa_get_string_param(const char *param_name)
{
    (void) param_name;
    return NULL;
}
