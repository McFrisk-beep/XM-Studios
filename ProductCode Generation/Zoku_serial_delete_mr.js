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
    var operationId = scriptObj.getParameter({
      name: "custscript_bulk_operation",
    });

    /*
    Operation ID:
    1 - Update
    2 - Delete
    3 - Inactivate
    */
    try {
      if (operationId == "1") {
        //Search for Fulfilled transactions without any 'Item Fulfillment' set (because it was deleted/disassociated)
        var prodCodeSearch = search.create({
          type: "customrecord_zoku_prodcode_custrec",
          filters: [
            ["custrecord_itemfulfillment", "anyof", "@NONE@"],
            "AND",
            ["custrecord_zoku_fulfilled", "is", "T"],
          ],
          columns: [
            search.createColumn({
              name: "id",
              sort: search.Sort.ASC,
              label: "ID",
            }),
            search.createColumn({
              name: "custrecord_zoku_serialnumber",
              label: "Serial Number",
            }),
          ],
        });
        return prodCodeSearch;
      } else if (operationId == "2" || operationId == "3") {
        //Use the local script saved search
        var prodCodeSearch = search.create({
          type: "customrecord_zoku_prodcode_custrec",
          filters: [
            ["custrecord_zoku_source", "anyof", "@NONE@"],
            "AND",
            ["custrecord_zoku_registered", "is", "F"],
            "AND",
            ["custrecord_zoku_fulfilled", "is", "F"],
          ],
          columns: [search.createColumn({ name: "id" })],
        });
        return prodCodeSearch;
      }
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
    var scriptObj = runtime.getCurrentScript();
    var operationId = scriptObj.getParameter({
      name: "custscript_bulk_operation",
    });
    //Log the result of the search
    var serialCodeId = JSON.parse(context.value);
    log.debug("MAP - serialCodeId", serialCodeId.id);

    /*
    Operation ID:
    1 - Update
    2 - Delete
    3 - Inactivate
    */
    try {
      if (operationId == "1") {
        //Set the product code to uncheck the 'item fulfilled' checkbox, since it's not linked to any item fulfillment
        record.submitFields({
          type: "customrecord_zoku_prodcode_custrec",
          id: serialCodeId.id,
          values: {
            custrecord_zoku_fulfilled: false,
          },
        });
      } else if (operationId == "2") {
        record.delete({
          type: "customrecord_zoku_prodcode_custrec",
          id: serialCodeId.id,
        });
      } else if (operationId == "3") {
        //Update the record to inactivate it
        record.submitFields({
          type: "customrecord_zoku_prodcode_custrec",
          id: serialCodeId.id,
          values: {
            isinactive: true,
          },
        });
      }
    } catch (e) {
      log.error("Error in MAP", e);
    }
  }

  /**
   * Executes when the summarize entry point is triggered and applies to the result set.
   *
   * @param {Summary} summary - Holds statistics regarding the execution of a map/reduce script
   * @since 2015.1
   */
  function summarize(summary) {
    log.audit("Summary Data", summary);
  }

  return {
    getInputData: getInputData,
    map: map,
    summarize: summarize,
  };
});
