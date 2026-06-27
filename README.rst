=====================
sphinx-riddle-whisper
=====================

.. |pypi| image:: https://img.shields.io/pypi/v/sphinx-riddle-whisper
   :target: https://pypi.org/project/sphinx-riddle-whisper/
   :alt: PyPI

.. |python| image:: https://img.shields.io/pypi/pyversions/sphinx-riddle-whisper
   :target: https://pypi.org/project/sphinx-riddle-whisper/
   :alt: Python versions

.. |license| image:: https://img.shields.io/badge/License-MIT-yellow.svg
   :target: https://opensource.org/licenses/MIT
   :alt: License: MIT

.. |lang-ja| image:: https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-red
   :target: README.ja.rst
   :alt: 日本語

|pypi| |python| |license| |lang-ja|

A Sphinx extension that shows full glossary term definitions in a popup — no
truncation, offline, vanilla JS.

When a reader hovers or clicks a ``:term:`` reference, the complete glossary
definition appears in a popover right where they are reading, so they never have
to jump to the glossary page and back.

Features
========

- **No truncation** — the full glossary definition is shown, with a configurable
  max height/width and scrolling for long entries.
- **Offline** — definitions are rendered at build time and injected as inline
  ``<template>`` elements. No network requests, no CDN.
- **Vanilla JS** — no third-party runtime libraries are bundled.
- **Hover and click** — open popovers on hover, click, or both.
- **Footnotes & citations** — optionally show footnote and citation bodies in the
  same popover style.
- **Image lightbox** — optionally open linked images in a focus-trapped lightbox.
- **Layered sanitization** — HTML is sanitized with `nh3 <https://pypi.org/project/nh3/>`_
  at build time and re-checked in the browser as a second line of defense.
- **Incremental build aware** — pages that reference a term are rebuilt when the
  term's home definition changes.

Requirements
============

- Python >= 3.11
- Sphinx >= 8

Installation
============

From PyPI:

.. code-block:: bash

   pip install sphinx-riddle-whisper

From source:

.. code-block:: bash

   pip install git+https://github.com/usaturn/sphinx-riddle-whisper.git

Or clone and install locally (this project uses `uv <https://docs.astral.sh/uv/>`_):

.. code-block:: bash

   git clone https://github.com/usaturn/sphinx-riddle-whisper.git
   cd sphinx-riddle-whisper
   uv pip install .

Quick Start
===========

Add the extension to your ``conf.py``:

.. code-block:: python

   extensions = ["sphinx_riddle_whisper"]

Define your terms with the standard ``glossary`` directive:

.. code-block:: rst

   .. glossary::

      reStructuredText
          A plain-text markup syntax and parser system, and the default
          markup language used by Sphinx.

Then reference them from any page with the ``:term:`` role:

.. code-block:: rst

   Sphinx documents are usually written in :term:`reStructuredText`.

Build your HTML as usual. Hovering or clicking the ``:term:`` reference now opens
a popover containing the full definition — no extra markup required.

Configuration
=============

All options are set in ``conf.py``. The display and feature options and their
defaults are:

.. list-table::
   :header-rows: 1
   :widths: 28 12 22 38

   * - Option
     - Type
     - Default
     - Description
   * - ``riddle_trigger``
     - str
     - ``"both"``
     - How popovers open: ``"hover"``, ``"click"``, or ``"both"``.
   * - ``riddle_max_height``
     - str
     - ``"24rem"``
     - Maximum popover height (any CSS length).
   * - ``riddle_max_width``
     - str
     - ``"32rem"``
     - Maximum popover width (any CSS length).
   * - ``riddle_open_delay_ms``
     - int
     - ``150``
     - Delay before opening on hover, in milliseconds (>= 0).
   * - ``riddle_close_delay_ms``
     - int
     - ``100``
     - Delay before closing on hover-out, in milliseconds (>= 0).
   * - ``riddle_interactive``
     - bool
     - ``True``
     - Keep the popover open while the pointer is over it.
   * - ``riddle_include_term_title``
     - bool
     - ``True``
     - Show the term name as a heading at the top of the popover.
   * - ``riddle_footnotes``
     - bool
     - ``True``
     - Enable popovers for footnote and citation references.
   * - ``riddle_image_popup``
     - bool
     - ``True``
     - Enable the image lightbox.

Example showing the defaults:

.. code-block:: python

   riddle_trigger = "both"
   riddle_max_height = "24rem"
   riddle_max_width = "32rem"
   riddle_open_delay_ms = 150
   riddle_close_delay_ms = 100
   riddle_interactive = True
   riddle_include_term_title = True
   riddle_footnotes = True
   riddle_image_popup = True

Footnotes, Citations & Image Lightbox
=====================================

With ``riddle_footnotes = True`` (the default), footnote and citation references
open a popover containing the footnote or citation body, drawn from the same page
— so readers can check a reference without losing their place.

With ``riddle_image_popup = True`` (the default), a linked image opens in a
focus-trapped, scroll-locked lightbox. Only safe image URLs (recognized image
extensions over allowed schemes) are opened.

Set either option to ``False`` to disable that feature.

Security
========

Glossary definitions can contain arbitrary inline HTML, so the extension
sanitizes content in two layers:

- **Build time** — definition fragments are sanitized with
  `nh3 <https://pypi.org/project/nh3/>`_ against a built-in allowlist of tags,
  attributes, and URL schemes before being injected.
- **Runtime** — before a popover is shown, the cloned fragment is walked again in
  the browser: elements outside the allowlist are removed, ``on*`` handlers and
  dangerous URL schemes are stripped, and ``target="_blank"`` links get
  ``rel="noopener noreferrer"``.

The safety-related options let you tune or replace the build-time allowlist:

.. list-table::
   :header-rows: 1
   :widths: 30 18 18 34

   * - Option
     - Type
     - Default
     - Description
   * - ``riddle_sanitize``
     - bool
     - ``True``
     - Enable build-time HTML sanitization with nh3.
   * - ``riddle_allowed_tags``
     - tuple[str] | None
     - ``None``
     - Allowed HTML tags. ``None`` uses the built-in allowlist.
   * - ``riddle_allowed_attributes``
     - dict[str, tuple[str]] | None
     - ``None``
     - Allowed attributes per tag. ``None`` uses the built-in allowlist.
   * - ``riddle_allowed_schemes``
     - tuple[str] | None
     - ``None``
     - Allowed URL schemes. ``None`` uses the built-in allowlist.
   * - ``riddle_strip_classes``
     - tuple[str]
     - ``("headerlink", "sd-stretched-link")``
     - CSS class names whose anchors are removed from the definition.

Documentation
=============

The full documentation is built with Sphinx from the ``docs/`` directory of this
repository.

License
=======

MIT
