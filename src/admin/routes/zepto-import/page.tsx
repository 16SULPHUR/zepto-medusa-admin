import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowDownTray } from "@medusajs/icons"

import ZeptoImportPage from "../../zepto-import/page.js"

export const config = defineRouteConfig({
	label: "Zepto Importer",
	icon: ArrowDownTray,
})

export default ZeptoImportPage
