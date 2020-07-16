/**
 * @license
 * Copyright 2011 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Components for creating connections between blocks.
 * @author fraser@google.com (Neil Fraser)
 */
'use strict';

goog.provide('Blockly.Connection');

goog.require('Blockly.Events');
goog.require('Blockly.Events.BlockMove');
goog.require('Blockly.Xml');

goog.requireType('Blockly.IASTNodeLocationWithBlock');
goog.requireType('Blockly.IConnectionChecker');


/**
 * Class for a connection between blocks.
 * @param {!Blockly.Block} source The block establishing this connection.
 * @param {number} type The type of the connection.
 * @constructor
 * @implements {Blockly.IASTNodeLocationWithBlock}
 */
Blockly.Connection = function(source, type) {
  /**
   * @type {!Blockly.Block}
   * @protected
   */
  this.sourceBlock_ = source;
  /** @type {number} */
  this.type = type;
};

/**
 * Constants for checking whether two connections are compatible.
 */
Blockly.Connection.CAN_CONNECT = 0;
Blockly.Connection.REASON_SELF_CONNECTION = 1;
Blockly.Connection.REASON_WRONG_TYPE = 2;
Blockly.Connection.REASON_TARGET_NULL = 3;
Blockly.Connection.REASON_CHECKS_FAILED = 4;
Blockly.Connection.REASON_DIFFERENT_WORKSPACES = 5;
Blockly.Connection.REASON_SHADOW_PARENT = 6;
Blockly.Connection.REASON_DRAG_CHECKS_FAILED = 7;

/**
 * Connection this connection connects to.  Null if not connected.
 * @type {Blockly.Connection}
 */
Blockly.Connection.prototype.targetConnection = null;

/**
 * Has this connection been disposed of?
 * @type {boolean}
 * @package
 */
Blockly.Connection.prototype.disposed = false;

/**
 * List of compatible value types.  Null if all types are compatible.
 * @type {Array}
 * @private
 */
Blockly.Connection.prototype.check_ = null;

/**
 * DOM representation of a shadow block, or null if none.
 * @type {Element}
 * @private
 */
Blockly.Connection.prototype.shadowDom_ = null;

/**
 * Horizontal location of this connection.
 * @type {number}
 * @package
 */
Blockly.Connection.prototype.x = 0;

/**
 * Vertical location of this connection.
 * @type {number}
 * @package
 */
Blockly.Connection.prototype.y = 0;

/**
 * Connect two connections together.  This is the connection on the superior
 * block.
 * @param {!Blockly.Connection} childConnection Connection on inferior block.
 * @protected
 */
Blockly.Connection.prototype.connect_ = function(childConnection) {
  var parentConnection = this;
  var parentBlock = parentConnection.getSourceBlock();
  var childBlock = childConnection.getSourceBlock();
  // Disconnect any existing parent on the child connection.
  if (childConnection.isConnected()) {
    childConnection.disconnect();
  }
  if (parentConnection.isConnected()) {
    // Other connection is already connected to something.
    // Disconnect it and reattach it or bump it as needed.
    var orphanBlock = parentConnection.targetBlock();
    var shadowDom = parentConnection.getShadowDom();
    // Temporarily set the shadow DOM to null so it does not respawn.
    parentConnection.setShadowDom(null);
    // Displaced shadow blocks dissolve rather than reattaching or bumping.
    if (orphanBlock.isShadow()) {
      // Save the shadow block so that field values are preserved.
      shadowDom = Blockly.Xml.blockToDom(orphanBlock);
      orphanBlock.dispose(false);
      orphanBlock = null;
    } else if (parentConnection.type == Blockly.INPUT_VALUE) {
      // Value connections.
      // If female block is already connected, disconnect and bump the male.
      if (!orphanBlock.outputConnection) {
        throw Error('Orphan block does not have an output connection.');
      }
      // Attempt to reattach the orphan at the end of the newly inserted
      // block.  Since this block may be a row, walk down to the end
      // or to the first (and only) shadow block.
      var connection = Blockly.Connection.lastConnectionInRow(
          childBlock, orphanBlock);
      if (connection) {
        orphanBlock.outputConnection.connect(connection);
        orphanBlock = null;
      }
    } else if (parentConnection.type == Blockly.NEXT_STATEMENT) {
      // Statement connections.
      // Statement blocks may be inserted into the middle of a stack.
      // Split the stack.
      if (!orphanBlock.previousConnection) {
        throw Error('Orphan block does not have a previous connection.');
      }
      // Attempt to reattach the orphan at the bottom of the newly inserted
      // block.  Since this block may be a stack, walk down to the end.
      var newBlock = childBlock;
      while (newBlock.nextConnection) {
        var nextBlock = newBlock.getNextBlock();
        if (nextBlock && !nextBlock.isShadow()) {
          newBlock = nextBlock;
        } else {
          var checker = orphanBlock.workspace.connectionChecker;
          if (checker.canConnect(
              orphanBlock.previousConnection, newBlock.nextConnection, false)) {
            newBlock.nextConnection.connect(orphanBlock.previousConnection);
            orphanBlock = null;
          }
          break;
        }
      }
    }
    if (orphanBlock) {
      // Unable to reattach orphan.
      parentConnection.disconnect();
      if (Blockly.Events.recordUndo) {
        // Bump it off to the side after a moment.
        var group = Blockly.Events.getGroup();
        setTimeout(function() {
          // Verify orphan hasn't been deleted or reconnected.
          if (orphanBlock.workspace && !orphanBlock.getParent()) {
            Blockly.Events.setGroup(group);
            if (orphanBlock.outputConnection) {
              orphanBlock.outputConnection.onFailedConnect(parentConnection);
            } else if (orphanBlock.previousConnection) {
              orphanBlock.previousConnection.onFailedConnect(parentConnection);
            }
            Blockly.Events.setGroup(false);
          }
        }, Blockly.BUMP_DELAY);
      }
    }
    // Restore the shadow DOM.
    parentConnection.setShadowDom(shadowDom);
  }

  var event;
  if (Blockly.Events.isEnabled()) {
    event = new Blockly.Events.BlockMove(childBlock);
  }
  // Establish the connections.
  Blockly.Connection.connectReciprocally_(parentConnection, childConnection);
  // Demote the inferior block so that one is a child of the superior one.
  childBlock.setParent(parentBlock);
  if (event) {
    event.recordNew();
    Blockly.Events.fire(event);
  }
};

/**
 * Dispose of this connection and deal with connected blocks.
 * @package
 */
Blockly.Connection.prototype.dispose = function() {

  // isConnected returns true for shadows and non-shadows.
  if (this.isConnected()) {
    this.setShadowDom(null);
    var targetBlock = this.targetBlock();
    if (targetBlock.isShadow()) {
      // Destroy the attached shadow block & its children.
      targetBlock.dispose(false);
    } else {
      // Disconnect the attached normal block.
      targetBlock.unplug();
    }
  }

  this.disposed = true;
};

/**
 * Get the source block for this connection.
 * @return {!Blockly.Block} The source block.
 */
Blockly.Connection.prototype.getSourceBlock = function() {
  return this.sourceBlock_;
};

/**
 * Does the connection belong to a superior block (higher in the source stack)?
 * @return {boolean} True if connection faces down or right.
 */
Blockly.Connection.prototype.isSuperior = function() {
  return this.type == Blockly.INPUT_VALUE ||
      this.type == Blockly.NEXT_STATEMENT;
};

/**
 * Is the connection connected?
 * @return {boolean} True if connection is connected to another connection.
 */
Blockly.Connection.prototype.isConnected = function() {
  return !!this.targetConnection;
};

/**
 * Checks whether the current connection can connect with the target
 * connection.
 * @param {Blockly.Connection} target Connection to check compatibility with.
 * @return {number} Blockly.Connection.CAN_CONNECT if the connection is legal,
 *    an error code otherwise.
 * @deprecated July 2020
 */
Blockly.Connection.prototype.canConnectWithReason = function(target) {
  // TODO: deprecation warning with date, plus tests.
  return this.getConnectionChecker().canConnectWithReason(
      this, target, false);
};

/**
 * Checks whether the current connection and target connection are compatible
 * and throws an exception if they are not.
 * @param {Blockly.Connection} target The connection to check compatibility
 *    with.
 * @package
 * @deprecated July 2020
 */
Blockly.Connection.prototype.checkConnection = function(target) {
// TODO: Add deprecation warning notices *and* add tests to make sure these
// still work (for any blocks that use them).
  var checker = this.getConnectionChecker();
  var reason = checker.canConnectWithReason(this, target, false);
  if (reason != Blockly.Connection.CAN_CONNECT) {
    throw new Error(checker.getErrorMessage(reason, this, target));
  }
};

/**
 * Get the workspace's connection type checker object.
 * @return {!Blockly.IConnectionChecker} The connection type checker for the
 *     source block's workspace.
 * @package
 */
Blockly.Connection.prototype.getConnectionChecker = function() {
  return this.sourceBlock_.workspace.connectionChecker;
};

/**
 * Check if the two connections can be dragged to connect to each other.
 * @param {!Blockly.Connection} candidate A nearby connection to check.
 * @return {boolean} True if the connection is allowed, false otherwise.
 * @deprecated July 2020
 */
Blockly.Connection.prototype.isConnectionAllowed = function(candidate) {
  return this.getConnectionChecker().canConnect(this, candidate, true);
};

/**
 * Behavior after a connection attempt fails.
 * @param {!Blockly.Connection} _otherConnection Connection that this connection
 *     failed to connect to.
 * @package
 */
Blockly.Connection.prototype.onFailedConnect = function(_otherConnection) {
  // NOP
};

/**
 * Connect this connection to another connection.
 * @param {!Blockly.Connection} otherConnection Connection to connect to.
 */
Blockly.Connection.prototype.connect = function(otherConnection) {
  if (this.targetConnection == otherConnection) {
    // Already connected together.  NOP.
    return;
  }

  var checker = this.getConnectionChecker();
  if (checker.canConnect(this, otherConnection, false)) {
    var eventGroup = Blockly.Events.getGroup();
    if (!eventGroup) {
      Blockly.Events.setGroup(true);
    }
    // Determine which block is superior (higher in the source stack).
    if (this.isSuperior()) {
      // Superior block.
      this.connect_(otherConnection);
    } else {
      // Inferior block.
      otherConnection.connect_(this);
    }
    if (!eventGroup) {
      Blockly.Events.setGroup(false);
    }
  }
};

/**
 * Update two connections to target each other.
 * @param {Blockly.Connection} first The first connection to update.
 * @param {Blockly.Connection} second The second connection to update.
 * @private
 */
Blockly.Connection.connectReciprocally_ = function(first, second) {
  if (!first || !second) {
    throw Error('Cannot connect null connections.');
  }
  first.targetConnection = second;
  second.targetConnection = first;
};

/**
 * Does the given block have one and only one connection point that will accept
 * an orphaned block?
 * @param {!Blockly.Block} block The superior block.
 * @param {!Blockly.Block} orphanBlock The inferior block.
 * @return {Blockly.Connection} The suitable connection point on 'block',
 *     or null.
 * @private
 */
Blockly.Connection.singleConnection_ = function(block, orphanBlock) {
  var connection = null;
  var output = orphanBlock.outputConnection;
  for (var i = 0; i < block.inputList.length; i++) {
    var thisConnection = block.inputList[i].connection;
    var typeChecker = output.getConnectionChecker();
    if (thisConnection && thisConnection.type == Blockly.INPUT_VALUE &&
        typeChecker.canConnect(output, thisConnection, false)) {
      if (connection) {
        return null;  // More than one connection.
      }
      connection = thisConnection;
    }
  }
  return connection;
};

/**
 * Walks down a row a blocks, at each stage checking if there are any
 * connections that will accept the orphaned block.  If at any point there
 * are zero or multiple eligible connections, returns null.  Otherwise
 * returns the only input on the last block in the chain.
 * Terminates early for shadow blocks.
 * @param {!Blockly.Block} startBlock The block on which to start the search.
 * @param {!Blockly.Block} orphanBlock The block that is looking for a home.
 * @return {Blockly.Connection} The suitable connection point on the chain
 *     of blocks, or null.
 * @package
 */
Blockly.Connection.lastConnectionInRow = function(startBlock, orphanBlock) {
  var newBlock = startBlock;
  var connection;
  while ((connection = Blockly.Connection.singleConnection_(
      /** @type {!Blockly.Block} */ (newBlock), orphanBlock))) {
    newBlock = connection.targetBlock();
    if (!newBlock || newBlock.isShadow()) {
      return connection;
    }
  }
  return null;
};

/**
 * Disconnect this connection.
 */
Blockly.Connection.prototype.disconnect = function() {
  var otherConnection = this.targetConnection;
  if (!otherConnection) {
    throw Error('Source connection not connected.');
  }
  if (otherConnection.targetConnection != this) {
    throw Error('Target connection not connected to source connection.');
  }
  var parentBlock, childBlock, parentConnection;
  if (this.isSuperior()) {
    // Superior block.
    parentBlock = this.sourceBlock_;
    childBlock = otherConnection.getSourceBlock();
    parentConnection = this;
  } else {
    // Inferior block.
    parentBlock = otherConnection.getSourceBlock();
    childBlock = this.sourceBlock_;
    parentConnection = otherConnection;
  }

  var eventGroup = Blockly.Events.getGroup();
  if (!eventGroup) {
    Blockly.Events.setGroup(true);
  }
  this.disconnectInternal_(parentBlock, childBlock);
  parentConnection.respawnShadow_();
  if (!eventGroup) {
    Blockly.Events.setGroup(false);
  }
};

/**
 * Disconnect two blocks that are connected by this connection.
 * @param {!Blockly.Block} parentBlock The superior block.
 * @param {!Blockly.Block} childBlock The inferior block.
 * @protected
 */
Blockly.Connection.prototype.disconnectInternal_ = function(parentBlock,
    childBlock) {
  var event;
  if (Blockly.Events.isEnabled()) {
    event = new Blockly.Events.BlockMove(childBlock);
  }
  var otherConnection = this.targetConnection;
  otherConnection.targetConnection = null;
  this.targetConnection = null;
  childBlock.setParent(null);
  if (event) {
    event.recordNew();
    Blockly.Events.fire(event);
  }
};

/**
 * Respawn the shadow block if there was one connected to the this connection.
 * @protected
 */
Blockly.Connection.prototype.respawnShadow_ = function() {
  var parentBlock = this.getSourceBlock();
  var shadow = this.getShadowDom();
  if (parentBlock.workspace && shadow && Blockly.Events.recordUndo) {
    var blockShadow =
        Blockly.Xml.domToBlock(shadow, parentBlock.workspace);
    if (blockShadow.outputConnection) {
      this.connect(blockShadow.outputConnection);
    } else if (blockShadow.previousConnection) {
      this.connect(blockShadow.previousConnection);
    } else {
      throw Error('Child block does not have output or previous statement.');
    }
  }
};

/**
 * Returns the block that this connection connects to.
 * @return {Blockly.Block} The connected block or null if none is connected.
 */
Blockly.Connection.prototype.targetBlock = function() {
  if (this.isConnected()) {
    return this.targetConnection.getSourceBlock();
  }
  return null;
};

/**
 * Is this connection compatible with another connection with respect to the
 * value type system.  E.g. square_root("Hello") is not compatible.
 * @param {!Blockly.Connection} otherConnection Connection to compare against.
 * @return {boolean} True if the connections share a type.
 */
Blockly.Connection.prototype.checkType = function(otherConnection) {
  // TODO (fenichel): Add deprecation warnings.
  return this.getConnectionChecker().canConnect(this, otherConnection,
      false);
};

/**
 * Is this connection compatible with another connection with respect to the
 * value type system.  E.g. square_root("Hello") is not compatible.
 * @param {!Blockly.Connection} otherConnection Connection to compare against.
 * @return {boolean} True if the connections share a type.
 * @private
 * @deprecated October 2019, use connection.checkType instead.
 * @suppress {unusedPrivateMembers}
 */
Blockly.Connection.prototype.checkType_ = function(otherConnection) {
  console.warn('Deprecated call to Blockly.Connection.prototype.checkType_, ' +
  'use Blockly.Connection.prototype.checkType instead.');
  return this.checkType(otherConnection);
};

/**
 * Function to be called when this connection's compatible types have changed.
 * @protected
 */
Blockly.Connection.prototype.onCheckChanged_ = function() {
  // The new value type may not be compatible with the existing connection.
  if (this.isConnected() && (!this.targetConnection ||
      !this.getConnectionChecker().canConnect(
          this, this.targetConnection, false))) {
    var child = this.isSuperior() ? this.targetBlock() : this.sourceBlock_;
    child.unplug();
  }
};

/**
 * Change a connection's compatibility.
 * @param {?(string|!Array.<string>)} check Compatible value type or list of
 *     value types. Null if all types are compatible.
 * @return {!Blockly.Connection} The connection being modified
 *     (to allow chaining).
 */
Blockly.Connection.prototype.setCheck = function(check) {
  if (check) {
    // Ensure that check is in an array.
    if (!Array.isArray(check)) {
      check = [check];
    }
    this.check_ = check;
    this.onCheckChanged_();
  } else {
    this.check_ = null;
  }
  return this;
};

/**
 * Get a connection's compatibility.
 * @return {Array} List of compatible value types.
 *     Null if all types are compatible.
 * @public
 */
Blockly.Connection.prototype.getCheck = function() {
  return this.check_;
};

/**
 * Change a connection's shadow block.
 * @param {Element} shadow DOM representation of a block or null.
 */
Blockly.Connection.prototype.setShadowDom = function(shadow) {
  this.shadowDom_ = shadow;
};

/**
 * Return a connection's shadow block.
 * @return {Element} Shadow DOM representation of a block or null.
 */
Blockly.Connection.prototype.getShadowDom = function() {
  return this.shadowDom_;
};

/**
 * Find all nearby compatible connections to this connection.
 * Type checking does not apply, since this function is used for bumping.
 *
 * Headless configurations (the default) do not have neighboring connection,
 * and always return an empty list (the default).
 * {@link Blockly.RenderedConnection} overrides this behavior with a list
 * computed from the rendered positioning.
 * @param {number} _maxLimit The maximum radius to another connection.
 * @return {!Array.<!Blockly.Connection>} List of connections.
 * @package
 */
Blockly.Connection.prototype.neighbours = function(_maxLimit) {
  return [];
};

/**
 * Get the parent input of a connection.
 * @return {Blockly.Input} The input that the connection belongs to or null if
 *     no parent exists.
 * @package
 */
Blockly.Connection.prototype.getParentInput = function() {
  var parentInput = null;
  var block = this.sourceBlock_;
  var inputs = block.inputList;
  for (var idx = 0; idx < block.inputList.length; idx++) {
    if (inputs[idx].connection === this) {
      parentInput = inputs[idx];
      break;
    }
  }
  return parentInput;
};

/**
 * This method returns a string describing this Connection in developer terms
 * (English only). Intended to on be used in console logs and errors.
 * @return {string} The description.
 */
Blockly.Connection.prototype.toString = function() {
  var msg;
  var block = this.sourceBlock_;
  if (!block) {
    return 'Orphan Connection';
  } else if (block.outputConnection == this) {
    msg = 'Output Connection of ';
  } else if (block.previousConnection == this) {
    msg = 'Previous Connection of ';
  } else if (block.nextConnection == this) {
    msg = 'Next Connection of ';
  } else {
    var parentInput = null;
    for (var i = 0, input; (input = block.inputList[i]); i++) {
      if (input.connection == this) {
        parentInput = input;
        break;
      }
    }
    if (parentInput) {
      msg = 'Input "' + parentInput.name + '" connection on ';
    } else {
      console.warn('Connection not actually connected to sourceBlock_');
      return 'Orphan Connection';
    }
  }
  return msg + block.toDevString();
};
