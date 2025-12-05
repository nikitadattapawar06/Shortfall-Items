# Copyright (c) 2025, nikita.pawar@intellore.com and contributors
# For license information, please see license.txt

# import frappe
import frappe
from frappe.model.document import Document

class ShortfallItems(Document):
    pass


@frappe.whitelist()
def create_shortfall_material_request(work_order):
    # Return existing draft MR if any
    existing = frappe.get_list("Material Request",
        filters={"work_order": work_order, "custom_shortfall_item_mr": 1, "docstatus": 0},
        fields=["name"],
        limit=1
    )
    if existing:
        return {"mr_name": existing[0].name, "mr_doctype": "Material Request"}

    wo = frappe.get_doc("Work Order", work_order)

    mr = frappe.new_doc("Material Request")
    mr.material_request_type = "Purchase"
    mr.custom_shortfall_item_mr = 1
    mr.work_order = work_order

    for item in wo.required_items:
        mr.append("items", {
            "item_code": item.item_code,
            "qty": item.required_qty,
            "warehouse": item.source_warehouse,
            "schedule_date": frappe.utils.nowdate()
        })

    mr.insert(ignore_permissions=True)
    return {"mr_name": mr.name, "mr_doctype": "Material Request"}
