# Importon Bridge

Importon Bridge connects a Chrome extension to WooCommerce so you can import products from Alibaba-style product pages into WordPress with one workflow.

[![WordPress](https://img.shields.io/badge/WordPress-6.0%2B-blue?logo=wordpress)](https://wordpress.org)
[![WooCommerce](https://img.shields.io/badge/WooCommerce-8.0%2B-purple?logo=woocommerce)](https://woocommerce.com)
[![PHP](https://img.shields.io/badge/PHP-7.4%2B-777BB4?logo=php)](https://php.net)
[![License](https://img.shields.io/badge/License-GPLv2%2B-green)](https://www.gnu.org/licenses/gpl-2.0.html)

## Overview

Importon Bridge is built for stores that want a simple, repeatable import workflow:

- a WordPress admin screen for setup and monitoring
- a Chrome extension for capturing product data from the browser
- a REST API for authenticated product creation and updates
- optional AI rewriting for titles and descriptions
- a batch URL import queue for pasting multiple product links at once

Alibaba is referenced only to describe supported product pages. Importon Bridge is not affiliated with Alibaba Group.

## What It Does

- imports product title, description, price, images, attributes, and variations
- supports simple and variable WooCommerce products
- can rewrite product copy through OpenAI or Google Gemini when enabled
- stores import run history and failed-item logs for review
- adds a product video to the gallery when a video URL is available

## Requirements

- WordPress 6.0+
- WooCommerce 8.0+
- PHP 7.4+
- Google Chrome or Chromium-based browser for the extension

## Installation

1. Download the latest release from the [Releases page](https://github.com/nasratulnayem/importon-bridge/releases/latest).
2. Upload the plugin to `/wp-content/plugins/` and activate it.
3. Make sure WooCommerce is installed and active.
4. Open **Importon Bridge** in the WordPress admin.
5. Download the Chrome extension from the plugin settings page and load it in Chrome.
6. Create a WordPress Application Password from your user profile and paste it into the extension together with your site URL and username.

## Plugin Workflow

1. Open an Alibaba product page in Chrome.
2. Use the Importon Bridge extension to capture the product data.
3. Send the data to WordPress through the authenticated REST API.
4. Create or update the WooCommerce product.
5. Optionally rewrite the content with AI before saving.

## REST API

The plugin exposes authenticated endpoints under `importonbridge/v1`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/wp-json/importonbridge/v1/import` | Create or update a WooCommerce product |
| `GET` | `/wp-json/importonbridge/v1/ping` | Confirm authentication |
| `GET` | `/wp-json/importonbridge/v1/categories` | List WooCommerce product categories |
| `GET` | `/wp-json/importonbridge/v1/settings` | Read extension settings |
| `POST` | `/wp-json/importonbridge/v1/settings` | Save extension settings |
| `POST` | `/wp-json/importonbridge/v1/connect` | Return connection details for the browser extension |

## AI Rewriting

AI rewriting is optional and only runs when you enable it in the admin settings.

- OpenAI and Google Gemini are both supported
- API keys are stored server-side in WordPress options
- You can choose provider order and model selection in the settings screen

## Security

- admin actions use WordPress nonces
- REST endpoints check authentication and capabilities
- user input is sanitized before storage or processing
- output is escaped before rendering
- external AI calls only happen when the administrator configures them

## Screenshots

1. Settings and connection screen
2. Batch URL import dashboard
3. AI rewrite settings and usage panels

## File Structure

```text
importon-bridge/
├── importon-bridge.php
├── README.txt
├── README.md
├── license.txt
├── assets/
│   └── url-import-admin.js
└── includes/
    ├── class-importonbridge-admin.php
    ├── class-importonbridge-frontend.php
    ├── class-importonbridge-rest.php
    └── class-importonbridge-url-import.php
```

## Changelog

### 0.1.0

- Initial release
- Chrome extension product import flow
- WooCommerce product creation and updates
- Optional AI rewriting
- Batch URL import queue
- Failed-run logging and admin monitoring

## License

GPLv2 or later
