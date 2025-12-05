# Copyright (c) 2025, nikita.pawar@intellore.com and contributors
# For license information, please see license.txt


# Copyright (c) 2025
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class ShortfallItems(Document):
    pass


@frappe.whitelist()
def create_shortfall_material_request(work_order):

    # ❌ Skip only Work Orders that have MR NOT cancelled
    existing = frappe.get_list(
        "Material Request",
        filters={
            "work_order": work_order,
            "custom_shortfall_item_mr": 1,
            "docstatus": ["!=", 2]  # 2 = Cancelled, allow MR creation
        },
        fields=["name"],
        limit=1
    )

    if existing:
        return {
            "mr_name": existing[0].name,
            "mr_doctype": "Material Request",
            "already_exists": 1
        }

    wo = frappe.get_doc("Work Order", work_order)

    mr = frappe.new_doc("Material Request")
    mr.material_request_type = "Purchase"
    mr.custom_shortfall_item_mr = 1
    mr.work_order = work_order

    for item in wo.required_items:
        # Use valid source warehouse
        source_wh = item.source_warehouse or wo.source_warehouse or wo.wip_warehouse
        if not source_wh:
            continue

        mr.append("items", {
            "item_code": item.item_code,
            "qty": item.required_qty,
            "warehouse": source_wh,
            "schedule_date": frappe.utils.nowdate()
        })

    mr.insert(ignore_permissions=True)
    return {
        "mr_name": mr.name,
        "mr_doctype": "Material Request",
        "already_exists": 0
    }
