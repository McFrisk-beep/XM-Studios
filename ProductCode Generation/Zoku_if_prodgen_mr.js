/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(["N/file", "N/record", "N/runtime", "N/search"], /**
 * @param {file} file
 * @param {record} record
 * @param {runtime} runtime
 * @param {search} search
 */ function (file, record, runtime, search) {
  /**
   * Marks the beginning of the Map/Reduce process and generates input data.
   *
   * @typedef {Object} ObjectRef
   * @property {number} id - Internal ID of the record instance
   * @property {string} type - Record type id
   *
   * @return {Array|Object|Search|RecordRef} inputSummary
   * @since 2015.1
   */
  function getInputData() {
    log.debug("getInputData", "*** START SCRIPT ***");
    var scriptObj = runtime.getCurrentScript();
    var internalId = scriptObj.getParameter({
      name: "custscript_itemfulfillment_id",
    });
    try {
      //Use the local script saved search
      var itemLineId = new Array();

      //Load the item fulfillment search to get the line sequence numebr
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
        columns: [search.createColumn({ name: "linesequencenumber" })],
      });
      itemfulfillmentSearchObj.run().each(function (result) {
        itemLineId.push(result.getValue({ name: "linesequencenumber" }));
        return true;
      });

      //This is our reference on what lines we'd read when we load the IF record
      return itemLineId;
    } catch (e) {
      log.error("Error on GETINPUTDATA", e);
    }
  }

  /**
   * Executes when the map entry point is triggered and applies to each key/value pair.
   *
   * @param {MapSummary} context - Data collection containing the key/value pairs to process through the map stage
   * @since 2015.1
   */

  function map(context) {
    //Placeholder for passing the data to the "reduce" stage
    var customRecordDetails = new Array();

    try {
      //The internal ID of the IF record from the parameter
      var scriptObj = runtime.getCurrentScript();
      var internalId = scriptObj.getParameter({
        name: "custscript_itemfulfillment_id",
      });

      var lineId = JSON.parse(context.value);
      log.debug("MAP - lineId", lineId);

      //Load the transaction record
      var itemFulfillment = record.load({
        type: record.Type.ITEM_FULFILLMENT,
        id: internalId,
        isDynamic: false,
      });
      var itemCount = itemFulfillment.getLineCount({ sublistId: "item" });

      //Go through each of the lines to get the matching "line" with the "line id"
      for (var x = 0; x < itemCount; x++) {
        var itemId = itemFulfillment.getSublistValue({
          sublistId: "item",
          fieldId: "item",
          line: x,
        });
        // log.debug("item ID", itemId);
        //If the item is valid for checking serial codes
        if (
          itemFulfillment.getSublistValue({
            sublistId: "item",
            fieldId: "line",
            line: x,
          }) == lineId
        ) {
          var serialSubrecord = itemFulfillment.getSublistSubrecord({
            sublistId: "item",
            fieldId: "inventorydetail",
            line: x,
          });
          var serialSubrecordCount = serialSubrecord.getLineCount({
            sublistId: "inventoryassignment",
          });
          log.debug("subrecord count", serialSubrecordCount);
          //Check the subrecord serial numbers to match
          for (var sub = 0; sub < serialSubrecordCount; sub++) {
            //Track script usage
            log.debug(
              "Remaining governance units: " + scriptObj.getRemainingUsage()
            );

            var issueInventoryNumber;
            var serialNumber = serialSubrecord.getSublistValue(
              "inventoryassignment",
              "issueinventorynumber_display",
              sub
            );

            //If there's a serialnumber value, skip the issueinventorynumber
            if (!serialNumber) {
              //Otherwise, we need to use this first as the "issueinventorynumber_display" is not always being passed especially if users
              //will enter the serial number on the item fulfillment stage
              issueInventoryNumber = serialSubrecord.getSublistValue(
                "inventoryassignment",
                "issueinventorynumber",
                sub
              );
              // log.debug("No initial serial number found.");

              //Another layer of search needs to happen first before we get the actual serial number
              //serialNumber = inventoryNumberSearch(issueInventoryNumber);
            }

            //var serialRecordId = serialCodeSearch(itemId, serialNumber);
            customRecordDetails.push([
              issueInventoryNumber,
              itemId,
              serialNumber,
            ]);
            //Clear the value for the next iteration
            issueInventoryNumber = "";
          }
        }
      }

      //Loop the current list of the custom records to be passed for creation on the "Reduce" part of the script
      for (var ctr = 0; ctr < customRecordDetails.length; ctr++) {
        context.write({
          key: ctr,
          value: customRecordDetails[ctr],
        });
      }
    } catch (e) {
      log.error("Error occurred in MAP", e);
    }
  }

  /**
   * Executes when the reduce entry point is triggered and applies to each group.
   *
   * @param {ReduceSummary} context - Data collection containing the groups to process through the reduce stage
   * @since 2015.1
   */
  function reduce(context) {
    //TODO: Add the reduce function for actual record saving. Further prevents script limits
    var dataValues = context.values.map(JSON.parse);
    /*
    dataValues[x][0] - issueInventoryNumber
    dataValues[x][1] - itemId
    dataValues[x][2] - serialNumber
    */

    var serialNumber, serialRecordId;
    //The internal ID of the IF record from the parameter
    var scriptObj = runtime.getCurrentScript();
    var internalId = scriptObj.getParameter({
      name: "custscript_itemfulfillment_id",
    });

    for (var x = 0; x < dataValues.length; x++) {
      if (!dataValues[x][2]) {
        serialNumber = inventoryNumberSearch(dataValues[x][0]);
        serialRecordId = serialCodeSearch(dataValues[x][1], serialNumber);
      } else {
        serialRecordId = serialCodeSearch(dataValues[x][1], dataValues[x][2]);
      }
      log.debug(
        "REDUCE serialnum | serialrecordid",
        serialNumber + " | " + serialRecordId
      );

      //Update the record for the product code
      record.submitFields({
        type: "customrecord_zoku_prodcode_custrec",
        id: serialRecordId,
        values: {
          custrecord_zoku_fulfilled: true,
          custrecord_itemfulfillment: internalId,
        },
      });
    }
  }

  /**
   * Executes when the summarize entry point is triggered and applies to the result set.
   *
   * @param {Summary} summary - Holds statistics regarding the execution of a map/reduce script
   * @since 2015.1
   */
  function summarize(context) {
    log.audit("Summary Data", context);
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
    serialSearch.run().each(function (result) {
      serialCodeId = result.getValue({ name: "id" });
    });
    return serialCodeId;
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
