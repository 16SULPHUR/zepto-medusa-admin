import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const storeModuleService = req.scope.resolve(Modules.STORE) as {
      listStores: (
        filters?: Record<string, unknown>,
        config?: Record<string, unknown>
      ) => Promise<Array<{ id?: string; name?: string; metadata?: Record<string, unknown> | null }>>
    }

    const stores = await storeModuleService.listStores(
      {},
      {
        take: 1,
      }
    )

    const store = stores?.[0]

    if (!store) {
      return res.status(404).json({
        store: null,
      })
    }

    return res.status(200).json({
      store: {
        id: store.id,
        name: store.name,
        metadata: store.metadata ?? null,
      },
    })
  } catch (error) {
    return res.status(500).json({
      store: null,
    })
  }
}
