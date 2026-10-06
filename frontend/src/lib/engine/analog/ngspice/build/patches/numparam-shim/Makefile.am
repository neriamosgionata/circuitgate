## Process this file with automake to produce Makefile.in
##
## CircuitGate license-clean build: the LGPL-2.1 numparam sources are
## replaced by a pass-through shim (see numparam_stub.c).

noinst_LTLIBRARIES = libnumparam.la

libnumparam_la_SOURCES = \
	numparam_stub.c \
	general.h \
	numpaif.h

AM_CPPFLAGS = @AM_CPPFLAGS@ -I$(top_srcdir)/src/include
AM_CFLAGS = $(STATIC)
MAINTAINERCLEANFILES = Makefile.in
