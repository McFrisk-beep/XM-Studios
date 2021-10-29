/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(["N/search", "N/record", "N/task"], function (search, record, task) {
  /**
   * Function definition to be triggered before record is loaded.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.newRecord - New record
   * @param {Record} scriptContext.oldRecord - Old record
   * @param {string} scriptContext.type - Trigger type
   * @Since 2015.2
   */
  function afterSubmit(scriptContext) {
    try {
      var itemFulfillment = scriptContext.newRecord;
      var itemCount = itemFulfillment.getLineCount({ sublistId: "item" });

      //C = Shipped
      if (
        itemFulfillment.getValue({ fieldId: "shipstatus" }) == "C" &&
        scriptContext.type != scriptContext.UserEventType.DELETE
      ) {
        var totalQuantity = checkApplicableProductsQuantity(
          itemFulfillment.getValue({ fieldId: "id" })
        );
        log.debug(
          "inside the shipped status",
          "itemCount - " +
            itemCount +
            " | " +
            "totalQuantity - " +
            totalQuantity
        );

        //Check if the item count reaches the threshold. If it does, pass the operation to the map/reduce
        if (itemCount > 5 || totalQuantity > 30) {
          var mapReduceTask = task.create({
            taskType: task.TaskType.MAP_REDUCE,
            scriptId: "customscript_zoku_if_prodcodgen_mr",
            params: {
              custscript_itemfulfillment_id: itemFulfillment.getValue({
                fieldId: "id",
              }),
            },
          });
          mapReduceTask.submit();
          log.debug("Passed operation to the Map Reduce script");
        } else {
          for (var x = 0; x < itemCount; x++) {
            var itemId = itemFulfillment.getSublistValue({
              sublistId: "item",
              fieldId: "item",
              line: x,
            });
            log.debug("item ID", itemId);
            //If the item is valid for checking serial codes
            if (checkSearch(itemId)) {
              log.debug("passed checkSearch");
              var serialSubrecord = itemFulfillment.getSublistSubrecord({
                sublistId: "item",
                fieldId: "inventorydetail",
                line: x,
              });
              log.debug("serialSubrecord", serialSubrecord);
              var serialSubrecordCount = serialSubrecord.getLineCount({
                sublistId: "inventoryassignment",
              });
              log.debug("subrecord count", serialSubrecordCount);
              //Check the subrecord serial numbers to match
              for (var sub = 0; sub < serialSubrecordCount; sub++) {
                var issueInventoryNumber;
                var serialNumber = serialSubrecord.getSublistValue(
                  "inventoryassignment",
                  "issueinventorynumber_display",
                  sub
                );
                log.debug("inside serialNumber", serialNumber);

                //If there's a serialnumber value, skip the issueinventorynumber
                if (!serialNumber) {
                  //Otherwise, we need to use this first as the "issueinventorynumber_display" is not always being passed especially if users
                  //will enter the serial number on the item fulfillment stage
                  issueInventoryNumber = serialSubrecord.getSublistValue(
                    "inventoryassignment",
                    "issueinventorynumber",
                    sub
                  );
                  log.debug("No initial serial number found.");
                  log.debug("issueinventorynumber", issueInventoryNumber);

                  //Another layer of search needs to happen first before we get the actual serial number
                  log.debug("issueInventoryNumber", issueInventoryNumber);
                  serialNumber = inventoryNumberSearch(issueInventoryNumber);
                }

                var serialRecordId = serialCodeSearch(itemId, serialNumber);
                log.debug("serialRecordId", serialRecordId);
                if (serialRecordId) {
                  record.submitFields({
                    type: "customrecord_zoku_prodcode_custrec",
                    id: serialRecordId,
                    values: {
                      custrecord_zoku_fulfilled: true,
                    },
                  });
                  log.debug(
                    "Serial Record updated successfully!",
                    serialRecordId
                  );
                }
                //Clear the value for the next iteration
                issueInventoryNumber = "";
              }
            }
          }
        }
      }
    } catch (e) {
      log.error("Error occured on afterSubmit", e);
    }
  }

  //Search for the inventory number set on the item fulfillment record
  function inventoryNumberSearch(numberId) {
    var serialCode;
    var inventorynumberSearchObj = search.create({
      type: "inventorynumber",
      filters: [["internalid", "anyof", numberId]],
      columns: [
        search.createColumn({
          name: "inventorynumber",
          sort: search.Sort.ASC,
          label: "Number",
        }),
        search.createColumn({ name: "item", label: "Item" }),
      ],
    });
    inventorynumberSearchObj.run().each(function (result) {
      serialCode = result.getValue({ name: "inventorynumber" });
      return false;
    });

    return serialCode;
  }

  //Search if the serial code record exists
  function serialCodeSearch(itemId, serialCode) {
    var serialCodeId = "";
    var serialSearch = search.create({
      type: "customrecord_zoku_prodcode_custrec",
      filters: [
        ["custrecord_zoku_serialnumber", "is", serialCode],
        "AND",
        ["custrecord_zoku_item", "anyof", itemId],
      ],
      columns: [search.createColumn({ name: "id" })],
    });
    var searchResultCount = serialSearch.runPaged().count;
    log.debug("serialSearch result count", searchResultCount);
    serialSearch.run().each(function (result) {
      serialCodeId = result.getValue({ name: "id" });
    });
    return serialCodeId;
  }

  //Check if the item record is applicable
  function checkSearch(itemId) {
    var serialItemSearch = search.create({
      type: "serializedinventoryitem",
      filters: [
        ["internalid", "anyof", itemId],
        "AND",
        ["type", "anyof", "InvtPart"],
        "AND",
        ["isserialitem", "is", "T"],
        "AND",
        ["custitem_zoku_prodcodetype", "noneof", "@NONE@"],
      ],
      columns: [search.createColumn({ name: "internalid" })],
    });
    return serialItemSearch.runPaged().count;
  }

  /*
    See how many items will need to be processed.
    Mostly for determining if the process would need to be passed to a Map/Reduce script

    params:
    internalId - the internal id of the PO record

    returns:
    int - the number of the search results applicable for processing
  */
  function checkApplicableProductsQuantity(internalId) {
    var itemfulfillmentSearchObj = search.create({
      type: "itemfulfillment",
      filters: [
        ["internalid", "anyof", internalId],
        "AND",
        ["type", "anyof", "ItemShip"],
        "AND",
        ["formulanumeric: MOD({linesequencenumber},3)", "equalto", "0"],
        "AND",
        ["item.type", "anyof", "InvtPart"],
        "AND",
        ["item.isserialitem", "is", "T"],
      ],
      columns: [search.createColumn({ name: "quantity", label: "Quantity" })],
    });
    var totalCount = 0;
    itemfulfillmentSearchObj.run().each(function (result) {
      totalCount += Math.abs(Number(result.getValue({ name: "quantity" })));
      return true;
    });
    return totalCount;
  }

  return {
    afterSubmit: afterSubmit,
  };
});
