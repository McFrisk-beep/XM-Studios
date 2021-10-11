/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(["N/search", "N/runtime", "N/record", "N/email"], function (
  search,
  runtime,
  record,
  email
) {
  /**
   * Function definition to be triggered before record is loaded.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.newRecord - New record
   * @param {Record} scriptContext.oldRecord - Old record
   * @param {string} scriptContext.type - Trigger type
   * @Since 2015.2
   */
  function beforeSubmit(scriptContext) {
    var itemFulfillment = scriptContext.newRecord;
    if (
      scriptContext.type == scriptContext.UserEventType.DELETE &&
      itemFulfillment.getValue({ fieldId: "shipstatus" }) == "C"
    ) {
      try {
        //Check if any assigned serial records were already applied
        log.debug(
          "Triggered delete",
          itemFulfillment.getValue({ fieldId: "id" })
        );
        var itemCount = itemFulfillment.getLineCount({ sublistId: "item" });
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
              // var serialNumber = serialSubrecord.getSublistValue(
              //   "inventoryassignment",
              //   "issueinventorynumber_display",
              //   sub
              // );
              // log.debug("inside serialNumber", serialNumber);

              //We need to use this first as the "issueinventorynumber_display" is not always being passed especially if users
              //will enter the serial number on the item fulfillment stage
              var issueInventoryNumber = serialSubrecord.getSublistValue(
                "inventoryassignment",
                "issueinventorynumber",
                sub
              );
              log.debug("issueinventorynumber", issueInventoryNumber);

              //Another layer of search needs to happen first before we get the actual serial number
              var serialNumber = inventoryNumberSearch(issueInventoryNumber);

              var serialRecordId = serialCodeSearch(itemId, serialNumber);
              log.debug("serialRecordId", serialRecordId);
              if (serialRecordId) {
                record.submitFields({
                  type: "customrecord_zoku_prodcode_custrec",
                  id: serialRecordId,
                  values: {
                    custrecord_zoku_fulfilled: false,
                  },
                });
                log.debug("Serial Record unset successfully!", serialRecordId);
              }
            }
          }
        }
      } catch (e) {
        log.error("Error occured on beforeSubmit", e);
      }
    }
  }

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
      //   var recordId = itemFulfillment.getValue({
      //     fieldId: "id",
      //   });
      var itemCount = itemFulfillment.getLineCount({ sublistId: "item" });

      //C = Shipped
      if (
        itemFulfillment.getValue({ fieldId: "shipstatus" }) == "C" &&
        scriptContext.type != scriptContext.UserEventType.DELETE
      ) {
        log.debug("inside the shipped status");
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

  return {
    beforeSubmit: beforeSubmit,
    afterSubmit: afterSubmit,
  };
});
