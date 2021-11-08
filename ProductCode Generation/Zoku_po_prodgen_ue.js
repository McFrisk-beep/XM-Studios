/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define([
  "N/search",
  "N/transaction",
  "N/record",
  "N/ui/message",
  "N/runtime",
], /**
 * @param {search} search
 * @param {transaction} transaction
 */ function (search, transaction, record, message, runtime) {
  /**
   * Function definition to be triggered before record is loaded.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.newRecord - New record
   * @param {string} scriptContext.type - Trigger type
   * @param {Form} scriptContext.form - Current form
   * @Since 2015.2
   */
  function beforeLoad(scriptContext) {
    try {
      var poRec = scriptContext.newRecord;
      var scriptObj = runtime.getCurrentScript();
      var operationId = scriptObj.getParameter({
        name: "custscript_mr_ss_url",
      });
      // log.debug("type", scriptContext.type + " | " + operationId);

      if (scriptContext.type == scriptContext.UserEventType.COPY) {
        poRec.setValue({ fieldId: "custbody_zoku_backend_status", value: "" });
        poRec.setValue({ fieldId: "custbody_zoku_codegen_status", value: 1 });
      } else if (
        scriptContext.type == scriptContext.UserEventType.VIEW &&
        poRec.getValue({ fieldId: "custbody_zoku_backend_status" }) != 2
      ) {
        //Use the local script saved search
        var transactionSearchObj = transactionSearch(
          poRec.getValue({ fieldId: "id" })
        );
        var searchResultCount = transactionSearchObj.runPaged().count;

        //Only display the button if there's applicable items where this should be displayed.
        if (searchResultCount > 0) {
          //Show not yet created banenr
          if (
            poRec.getValue({ fieldId: "custbody_zoku_codegen_status" }) ==
              "1" ||
            poRec.getValue({ fieldId: "custbody_zoku_codegen_status" }) == ""
          ) {
            scriptContext.form.addPageInitMessage({
              type: message.Type.INFORMATION,
              title: "The Product Codes are not yet created for this order",
              message:
                "Please finalize the transaction and click 'Generate' to update the Product Codes once finalized.",
            });
            scriptContext.form.addButton({
              id: "custpage_generate",
              label: "Generate Product Code",
              functionName: "generateFlow",
            });
            scriptContext.form.clientScriptModulePath =
              "SuiteScripts/Zoku_po_prodgen_cs.js";
          }
          //Show incomplete banner
          else if (
            poRec.getValue({ fieldId: "custbody_zoku_codegen_status" }) == "2"
          ) {
            scriptContext.form.addPageInitMessage({
              type: message.Type.INFORMATION,
              title: "This Purchase Order has incomplete Product Codes",
              message:
                "The Product Codes for the serialized item is incomplete. Please finalize the transaction and click 'Generate' to update the Product Codes accordingly.",
            });
            scriptContext.form.addButton({
              id: "custpage_generate",
              label: "Generate Product Code",
              functionName: "generateFlow",
            });
            scriptContext.form.clientScriptModulePath =
              "SuiteScripts/Zoku_po_prodgen_cs.js";
          }
          //Show generated banner
          else if (
            poRec.getValue({ fieldId: "custbody_zoku_codegen_status" }) == "3"
          ) {
            scriptContext.form.addPageInitMessage({
              type: message.Type.CONFIRMATION,
              title:
                "This Product Codes have been generated for this transaction",
              message: "The Product Codes are all generated for this item.",
            });
          }
        }
      } else if (
        poRec.getValue({ fieldId: "custbody_zoku_backend_status" }) == 2
      ) {
        scriptContext.form.addPageInitMessage({
          type: message.Type.INFORMATION,
          title:
            "(RECORD CANNOT BE MODIFIED) This transaction is scheduled for Back-end processing",
          message:
            "The Product Codes are being created for this transaction. Record is locked until completion. Please check back later once the script processing completes.\n" +
            "Please click <a href='" +
            operationId +
            "'>here</a> " +
            "for the status of the script.",
        });
      }
    } catch (e) {
      log.error("Error occured on beforeLoad", e);
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
  function beforeSubmit(scriptContext) {
    // try {
    var poRec = scriptContext.newRecord;
    //Check if the user is in EDIT/COPY mode. Create naturally has no Inventory Details generated for it anyways
    if (
      scriptContext.type == scriptContext.UserEventType.EDIT ||
      scriptContext.type == scriptContext.UserEventType.COPY
    ) {
      log.debug(
        "Potential transaction for checking",
        "ID: " + poRec.getValue({ fieldId: "id" })
      );
      var itemLineId = new Array();
      var itemLine = -1;
      var poId = poRec.getValue({ fieldId: "id" });
      var internalFlag = true;
      var lineCount = poRec.getLineCount({ sublistId: "item" });
      var serialLineId = new Array();

      //Check if the item fits the criteria of the serial codes automatic generation
      var invDetail;
      var invDetailCount = 0;
      var invDetailSerial = "";
      var itemId = "";
      log.debug("Initializing Check User-input");
      for (var x = 0; x < lineCount; x++) {
        //Select new line
        itemId = poRec.getSublistValue({
          sublistId: "item",
          fieldId: "item",
          line: x,
        });
        //If a search result comes back, this means that the item fits the description
        if (checkSearch(itemId) > 0) {
          //Check the subrecord to see if there's user-entered PO values
          //We only check user-entered. The system should still allow missing values, as the system will generate later on
          invDetail = poRec.getSublistSubrecord({
            sublistId: "item",
            fieldId: "inventorydetail",
            line: x,
          });
          invDetailCount = invDetail.getLineCount({
            sublistId: "inventoryassignment",
          });
          if (invDetailCount > 0) {
            for (var y = 0; y < invDetailCount; y++) {
              invDetailSerial = ""; //Clear this to remove the last value
              invDetailSerial = invDetail.getSublistValue({
                sublistId: "inventoryassignment",
                fieldId: "receiptinventorynumber",
                line: y,
              });
              if (invDetailSerial) {
                //If no results are returned, this is user-entered. Flag this.
                if (confirmSerialCodes(poId, itemId, invDetailSerial) == 0) {
                  log.debug("Found an invalid serial code!", invDetailSerial);
                  invDetail.removeLine({
                    sublistId: "inventoryassignment",
                    line: y,
                    ignoreRecalc: true,
                  });
                  y--;
                  invDetailCount--;

                  throw "Please remove invalid serial codes and try again!";
                }
              }
            }
          }
        }
      }

      //Before anything else, check if there's a new item(s) added which fit the criteria
      var oldPoRec = record.load({
        type: record.Type.PURCHASE_ORDER,
        id: poRec.getValue({ fieldId: "id" }),
      });
      var compareLines = lineCount;
      for (var x = 0; x < compareLines; x++) {
        //Check if this is already the new item lines
        if (x >= oldPoRec.getLineCount({ sublistId: "item" })) {
          //If it is the new lines, confirm the item type of the newly added. If it's a serialized inventory item, flag it
          log.debug(
            "New item line detected",
            "ID" +
              poRec.getSublistValue({
                sublistId: "item",
                fieldId: "item",
                line: x,
              })
          );
          if (
            checkSearch(
              poRec.getSublistValue({
                sublistId: "item",
                fieldId: "item",
                line: x,
              })
            ) > 0
          ) {
            poRec.setValue({
              fieldId: "custbody_zoku_codegen_status",
              value: 2,
            });
            x = lineCount; //Terminate the loop
            internalFlag = false;

            log.audit("System Flagged INCOMPLETE", "New items have been added");
          }
        } else {
          //If it's not yet the new item lines, match the line ID
          //Check if the line ID matches. Mismatch usually means that this is a new line, or a line is removed and re-added
          log.debug(
            "Existing line check",
            "ID" +
              poRec.getSublistValue({
                sublistId: "item",
                fieldId: "item",
                line: x,
              })
          );
          if (
            oldPoRec.getSublistValue("item", "line", x) !=
              poRec.getSublistValue("item", "line", x) ||
            oldPoRec.getSublistValue("item", "item", x) !=
              poRec.getSublistValue("item", "item", x)
          ) {
            //Confirm the new item then, if it's a serialized inventory item.
            //If the checkSearch > 0, then this is most likely a new item. Flag this.
            if (
              checkSearch(
                poRec.getSublistValue({
                  sublistId: "item",
                  fieldId: "item",
                  line: x,
                })
              ) > 0
            ) {
              poRec.setValue({
                fieldId: "custbody_zoku_codegen_status",
                value: 2,
              });
              x = lineCount; //Terminate the loop
              internalFlag = false;

              log.audit(
                "System Flagged INCOMPLETE",
                "New items have been added"
              );
            }
          }
        }
      }

      //If at this point, the flag already detected a mismatch, skip this function and let the record save
      if (internalFlag) {
        //Check if there are connected Product codes generated for this transaction
        var transactionSearchObj = transactionSearch(poId);
        var searchResultCount = transactionSearchObj.runPaged().count;
        transactionSearchObj.run().each(function (result) {
          itemLineId.push(result.getValue({ name: "line" }));
          return true;
        });

        //If there's lines that fit the criteria, proceed with checking to see if there's created Product Codes
        if (searchResultCount > 0) {
          log.debug("Applicable items found", searchResultCount);
          for (var x = 0; x < lineCount; x++) {
            //Get the index of the line referenced from the search
            itemLine = itemLineId.indexOf(
              poRec.getSublistValue({
                sublistId: "item",
                fieldId: "line",
                line: x,
              })
            );

            var currentItem = poRec.getSublistValue({
              sublistId: "item",
              fieldId: "item",
              line: x,
            });

            //If it's greater than -1, meaning the line is applicable for the product code generation
            if (itemLine > -1) {
              log.debug(
                "Item match",
                poRec.getSublistValue({
                  sublistId: "item",
                  fieldId: "item",
                  line: x,
                })
              );
              //Search if the itemLine exists
              var prodCodeSearch = search.create({
                type: "customrecord_zoku_prodcode_custrec",
                filters: [
                  ["custrecord_zoku_item", "anyof", currentItem],
                  "AND",
                  ["custrecord_zoku_source", "anyof", poId],
                  "AND",
                  ["isinactive", "is", "F"],
                ],
                columns: [
                  search.createColumn({
                    name: "custrecord_zoku_source",
                  }),
                  search.createColumn({
                    name: "custrecord_zoku_serialnumber",
                  }),
                  search.createColumn({
                    name: "name",
                  }),
                  search.createColumn({
                    name: "custrecord_zoku_registered",
                  }),
                  search.createColumn({
                    name: "custrecord_zoku_fulfilled",
                  }),
                  search.createColumn({
                    name: "custrecord_zoku_lineid",
                  }),
                ],
              });
              var serialCount = prodCodeSearch.runPaged().count;
              var prodCodes = new Array();

              //See if there's serial numbers already generated for the item on the custom record
              if (serialCount) {
                log.debug("Serial numbers found", serialCount);
                prodCodeSearch.run().each(function (result) {
                  prodCodes.push(
                    result.getValue({ name: "custrecord_zoku_serialnumber" })
                  );
                  serialLineId.push(
                    result.getValue({ name: "custrecord_zoku_lineid" })
                  );
                  return true;
                });

                //Get the subrecord of the item
                var invDetail = poRec.getSublistSubrecord({
                  sublistId: "item",
                  fieldId: "inventorydetail",
                  line: x,
                });
                var invQuantity = poRec.getSublistValue({
                  sublistId: "item",
                  fieldId: "quantity",
                  line: x,
                });
                var invDetailCount = invDetail.getLineCount({
                  sublistId: "inventoryassignment",
                });
                var invDetailSerial;

                //If there's inventory details on the item, proceed with checking
                //Also check if the detailsCount matches the quantity of the item. Otherwise, there's also a discrepancy there.
                if (invDetailCount > 0 && invDetailCount === invQuantity) {
                  for (var subLine = 0; subLine < invDetailCount; subLine++) {
                    //Check if the serial number exists on the product codes custom record
                    invDetailSerial = invDetail.getSublistValue({
                      sublistId: "inventoryassignment",
                      fieldId: "receiptinventorynumber",
                      line: subLine,
                    });
                    log.debug("Subline Loop", invDetailSerial);
                    //If there's no results for the code, the entire record is already 'INCOMPLETE'. Mark and skip entire process
                    if (prodCodes.indexOf(invDetailSerial) == -1) {
                      poRec.setValue({
                        fieldId: "custbody_zoku_codegen_status",
                        value: 2,
                      });

                      //Terminate the loop
                      x = lineCount;
                      subLine = invDetailCount;

                      log.audit(
                        "System Flagged INCOMPLETE",
                        "Inventory serial not found on transaction."
                      );
                      internalFlag = false;
                    }
                  }
                  if (internalFlag) {
                    //If the internal flag was not changed, we can confirm that all product codes have been generated for this item
                    poRec.setValue({
                      fieldId: "custbody_zoku_codegen_status",
                      value: "3",
                    });
                  }
                } else {
                  //If there's no line, then there's already a mismatch. There is a serial number, but no inventory detail
                  //Same if the inventory detail count does not match the quantity, this is also 'INCOMPLETE'
                  poRec.setValue({
                    fieldId: "custbody_zoku_codegen_status",
                    value: 2,
                  });
                  x = lineCount;

                  log.audit(
                    "System Flagged INCOMPLETE",
                    "Inventory detail is 0 or Inventory detail count does not match Inventory Quantity"
                  );
                }
              }
              //If there's none, just update the status immediately that the code generation status is incomplete
              else {
                poRec.setValue({
                  fieldId: "custbody_zoku_codegen_status",
                  value: 2,
                });
                x = lineCount; //Terminate the loop

                log.audit(
                  "System Flagged INCOMPLETE",
                  "No serial numbers for the Item Line"
                );
              }
            }
          }
        } else {
          //Since this transaction is not applicable anymore, set to 'NOT APPLICABLE' if it is not set already
          poRec.setValue({
            fieldId: "custbody_zoku_codegen_status",
            value: 4,
          });
        }
      }

      //Processes the deleted serial codes to be processed
      //This runs regardless of all outcome checks to make sure that the data is always updated
      var forInactivation = new Array();
      var serialSearch = search.create({
        type: "customrecord_zoku_prodcode_custrec",
        filters: [["custrecord_zoku_source", "anyof", poId]],
        columns: [
          search.createColumn({
            name: "id",
          }),
          search.createColumn({
            name: "custrecord_zoku_item",
          }),
          search.createColumn({
            name: "custrecord_zoku_lineid",
          }),
          search.createColumn({
            name: "custrecord_zoku_serialnumber",
          }),
        ],
      });

      //Store the search results for use on the comparison later
      serialSearch.run().each(function (result) {
        forInactivation.push({
          internalid: result.getValue({ name: "id" }),
          // itemid: result.getValue({ name: "custrecord_zoku_item" }),
          // lineid: result.getValue({ name: "custrecord_zoku_lineid" }),
          serialnum: result.getValue({
            name: "custrecord_zoku_serialnumber",
          }),
        });
        return true;
      });
      log.debug("forInactivation before", forInactivation);

      if (forInactivation.length) {
        for (var x = 0; x < lineCount; x++) {
          //Get the inventory detail subrecord from the transaction line
          var serialSubrecord = poRec.getSublistSubrecord({
            sublistId: "item",
            fieldId: "inventorydetail",
            line: x,
          });
          var serialSubrecordCount = serialSubrecord.getLineCount({
            sublistId: "inventoryassignment",
          });
          var serialNumber, existLocation;

          //Check the subrecord serial numbers to match
          for (var sub = 0; sub < serialSubrecordCount; sub++) {
            serialNumber = serialSubrecord.getSublistValue(
              "inventoryassignment",
              "receiptinventorynumber",
              sub
            );

            //Check if the serial number exists
            existLocation = forInactivation
              .map(function (e) {
                return e.serialnum;
              })
              .indexOf(serialNumber);

            //If it exists, remove the serial number referenced for deletion
            if (existLocation > -1) {
              forInactivation.splice(existLocation, 1);
            }
          }
        }
      }
      log.debug("forInactivation after", forInactivation);

      //Any values that remains means that they have no match from the transation. These can be inactivated.
      for (var x = 0; x < forInactivation.length; x++) {
        record.submitFields({
          type: "customrecord_zoku_prodcode_custrec",
          id: forInactivation[x].internalid,
          values: {
            isinactive: true,
          },
        });
      }
    } else if (scriptContext.type == scriptContext.UserEventType.DELETE) {
      //Delete the associated serial codes if the user deletes the PO as well
      var poId = poRec.getValue({ fieldId: "id" });
      var serialCodeDelete = search.create({
        type: "customrecord_zoku_prodcode_custrec",
        filters: [
          ["custrecord_zoku_source", "anyof", poId],
          "AND",
          ["isinactive", "any", ""],
        ],
        columns: [search.createColumn({ name: "id" })],
      });
      serialCodeDelete.run().each(function (result) {
        record.delete({
          type: "customrecord_zoku_prodcode_custrec",
          id: result.getValue({ name: "id" }),
        });
        return true;
      });
    }
    // } catch (e) {
    //   log.error("Error occured on beforeSubmit", e);
    // }

    var scriptObj = runtime.getCurrentScript();
    log.debug("Remaining governance units: " + scriptObj.getRemainingUsage());
  }

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

  function transactionSearch(poId) {
    return search.create({
      type: "transaction",
      filters: [
        ["internalid", "anyof", poId],
        "AND",
        ["mainline", "is", "F"],
        "AND",
        ["item.type", "anyof", "InvtPart"],
        "AND",
        ["item.isserialitem", "is", "T"],
        "AND",
        ["formulatext: {item.custitem_zoku_prodcodetype}", "isnotempty", ""],
      ],
      columns: [search.createColumn({ name: "line" })],
    });
  }

  //Check if the serial code does not exist on the item subrecord
  function confirmSerialCodes(poId, itemId, serialNum) {
    var serialCodeSearch = search.create({
      type: "customrecord_zoku_prodcode_custrec",
      filters: [
        ["custrecord_zoku_source", "anyof", poId],
        "AND",
        ["custrecord_zoku_item", "anyof", itemId],
        "AND",
        ["custrecord_zoku_serialnumber", "is", serialNum],
      ],
      columns: [search.createColumn({ name: "id" })],
    });

    return serialCodeSearch.runPaged().count;
  }

  return {
    beforeLoad: beforeLoad,
    beforeSubmit: beforeSubmit,
  };
});
