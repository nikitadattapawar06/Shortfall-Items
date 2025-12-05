// =======================================================
// LOADER HTML
// =======================================================
function get_loader_html(message = "Loading...") {
    return `
        <div style="
            display:flex;
            align-items:center;
            gap:12px;
            padding:20px;
            background:#f7f9ff;
            border:1px solid #dbe3ff;
            border-radius:6px;
            color:#3f51b5;
            font-weight:600;">
            <i class="fa fa-circle-o-notch fa-spin fa-lg"></i> ${message}
        </div>
    `;
}

// =======================================================
// HELPER: CHECK IF WORK ORDER HAS DRAFT MR
// =======================================================
async function has_draft_mr(wo_name) {
    let mr = await frappe.db.get_list("Material Request", {
        filters: {
            work_order: wo_name,
            custom_shortfall_item_mr: 1,
            docstatus: 0   // DRAFT only
        },
        limit: 1
    });
    return mr.length > 0;
}

// =======================================================
// CLIENT SCRIPT
// =======================================================
frappe.ui.form.on('Shortfall Items', {

    refresh(frm) {
        frm.trigger("bind_buttons");
    },

    bind_buttons(frm) {
        frm.fields_dict.get_work_orders.$input?.off("click").on("click", () => frm.trigger("load_work_orders"));
        frm.fields_dict.get_purchase_request.$input?.off("click").on("click", () => frm.trigger("load_purchase_requests"));
    },

    // ===================================================
    // 1️⃣ LOAD WORK ORDERS WITH SHORTFALL
    // ===================================================
    async load_work_orders(frm) {

        // Show loader immediately
        frm.set_df_property("work_order", "options",
            get_loader_html("Scanning Work Orders for Shortfall...")
        );

        let work_orders = await frappe.db.get_list("Work Order", {
            filters: { docstatus: 1, status: ["!=", "Completed"] },
            fields: ["name", "status"]
        });

        let rows = [];

        for (let wo of work_orders) {

            if (await has_draft_mr(wo.name)) continue; // Skip WO if DRAFT MR exists

            let wo_doc = await frappe.db.get_doc("Work Order", wo.name);

            for (let item of wo_doc.required_items) {

                if (!item.source_warehouse) continue;

                let bin = await frappe.db.get_value("Bin", {
                    item_code: item.item_code,
                    warehouse: item.source_warehouse
                }, ["actual_qty", "projected_qty"]);

                let actual_qty = bin?.message?.actual_qty || 0;
                let projected_qty = bin?.message?.projected_qty || 0;
                let shortfall = flt(item.required_qty) - actual_qty;

                if (shortfall <= 0) continue;

                rows.push({
                    wo_name: wo.name,
                    wo_status: wo.status,
                    item: item.item_code,
                    source_wh: item.source_warehouse,
                    target_wh: item.warehouse || "",
                    req_qty: item.required_qty,
                    actual_qty: actual_qty,
                    projected_qty: projected_qty,
                    shortfall: shortfall
                });
            }
        }

        if (!rows.length) {
            frm.set_df_property("work_order", "options",
                "<p style='color:green;font-weight:bold;'>✅ No Work Orders with shortfall.</p>"
            );
            return;
        }

        // Group by Work Order
        let grouped = {};
        rows.forEach(r => {
            if (!grouped[r.wo_name]) grouped[r.wo_name] = [];
            grouped[r.wo_name].push(r);
        });

        // Build HTML
        let html = `
            <style>
                .wo-head {
                    background:#eef2ff;
                    padding:8px;
                    margin-top:12px;
                    border-left:4px solid #4b74ff;
                    font-weight:bold;
                }
                .mr-btn {
                    float:right;
                    font-size:12px;
                    padding:4px 8px;
                }
            </style>
        `;

        for (let wo in grouped) {

            let wo_status = grouped[wo][0].wo_status;

            html += `
                <div class="wo-head">
                    <a href="/app/work-order/${wo}" target="_blank">${wo}</a> | Status: ${wo_status}
                    <button class="btn btn-primary btn-xs mr-btn" data-wo="${wo}">Create MR</button>
                </div>

                <table class="table table-bordered table-sm">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Source Warehouse</th>
                            <th>Target Warehouse</th>
                            <th>Required Qty</th>
                            <th>Current Stock</th>
                            <th>Projected Qty</th>
                            <th>Shortfall Qty</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            grouped[wo].forEach(r => {
                html += `
                    <tr>
                        <td>${r.item}</td>
                        <td>${r.source_wh}</td>
                        <td>${r.target_wh}</td>
                        <td>${r.req_qty}</td>
                        <td>${r.actual_qty}</td>
                        <td>${r.projected_qty}</td>
                        <td><b style="color:red;">${r.shortfall}</b></td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
        }

        frm.set_df_property("work_order", "options", html);

        // Create MR button click
        setTimeout(() => {
            $(".mr-btn").off("click").on("click", function () {

                let wo = $(this).data("wo");

                frappe.call({
                    method: "create_shortfall_material_request",
                    args: { work_order: wo },
                    freeze: true,
                    freeze_message: "Creating Material Request...",
                    callback: function (r) {

                        if (!r.message) return;

                        frappe.msgprint(`<b>✅ Material Request Created:</b><br>
                            <a href="/app/material-request/${r.message.mr_name}" target="_blank">
                                ${r.message.mr_name}
                            </a>`);

                        frm.trigger("load_work_orders"); // Refresh list
                    }
                });
            });
        }, 200);
    },


    // ===================================================
    // 2️⃣ LOAD DRAFT PURCHASE REQUESTS WITH DETAILS
    // ===================================================
    async load_purchase_requests(frm) {

        // Show loader immediately
        frm.set_df_property("purchase_request", "options",
            get_loader_html("Loading Draft Shortfall Requests...")
        );

        let mr_list = await frappe.db.get_list("Material Request", {
            filters: { custom_shortfall_item_mr: 1, docstatus: 0 },
            fields: ["name", "work_order", "status", "docstatus"],
            order_by: "creation desc"
        });

        if (!mr_list.length) {
            frm.set_df_property("purchase_request", "options",
                "<p style='color:orange;font-weight:bold;'>⚠ No Draft Shortfall Requests found.</p>"
            );
            return;
        }

        let html = `
            <style>
                .mr-head {
                    background:#fff4e6;
                    padding:8px;
                    margin-top:12px;
                    border-left:4px solid #ff9800;
                    font-weight:bold;
                }
            </style>
        `;

        for (let mr of mr_list) {

            let mr_doc = await frappe.db.get_doc("Material Request", mr.name);
            let wo_doc = await frappe.db.get_doc("Work Order", mr.work_order);

            // Map WO items
            let wo_items_map = {};
            wo_doc.required_items.forEach(i => {
                wo_items_map[i.item_code] = i;
            });

            html += `
                <div class="mr-head">
                    Purchase Request:
                    <a href="/app/material-request/${mr.name}" target="_blank">${mr.name}</a>
                    &nbsp;|&nbsp;
                    Work Order:
                    <a href="/app/work-order/${mr.work_order}" target="_blank">${mr.work_order}</a>
                    &nbsp;|&nbsp;WO Status: ${wo_doc.status}
                    <span style="float:right;">MR Status: Draft</span>
                </div>

                <table class="table table-bordered table-sm">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Source Warehouse</th>
                            <th>Target Warehouse</th>
                            <th>Required Qty</th>
                            <th>Current Stock</th>
                            <th>Projected Qty</th>
                            <th>Shortfall Qty</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            for (let item of mr_doc.items) {

                let wo_item = wo_items_map[item.item_code] || {};
                let source_wh = wo_item.source_warehouse || "N/A";
                let target_wh = item.warehouse || "N/A";
                let required_qty = wo_item.required_qty || item.qty;

                let stock = await frappe.db.get_value("Bin", {
                    item_code: item.item_code,
                    warehouse: source_wh
                }, ["actual_qty", "projected_qty"]);

                let actual_qty = stock?.message?.actual_qty || 0;
                let projected_qty = stock?.message?.projected_qty || 0;
                let shortfall = required_qty - actual_qty;
                if (shortfall < 0) shortfall = 0;

                html += `
                    <tr>
                        <td>${item.item_code}</td>
                        <td>${source_wh}</td>
                        <td>${target_wh}</td>
                        <td>${required_qty}</td>
                        <td>${actual_qty}</td>
                        <td>${projected_qty}</td>
                        <td><b style="color:red;">${shortfall}</b></td>
                    </tr>
                `;
            }

            html += `</tbody></table>`;
        }

        frm.set_df_property("purchase_request", "options", html);
    }

});
